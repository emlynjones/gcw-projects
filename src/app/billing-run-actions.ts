"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getConnection } from "@/lib/xero";
import { ensureXeroContactForClient } from "@/modules/accounting/xero/contacts";
import {
  BILLABLE_SELECT,
  itemPriceMap,
  toBillableLines,
  raiseInvoiceFor,
  type BillableLine,
} from "@/lib/billing-raise";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

export type ClientGroup = {
  clientId: string;
  clientName: string;
  /** Lines grouped under the website they belong to; "" for unattached. */
  sites: { websiteId: string | null; websiteName: string; lines: BillableLine[] }[];
  total: number;
  overdue: number;
  dueSoon: number;
  belowCost: number;
};

export type BillingRunResult = {
  groups: ClientGroup[];
  overdueCount: number;
  overdueValue: number;
  dueSoonCount: number;
  dueSoonValue: number;
  /** Owing something, but with no price from either the service or Xero. */
  noPriceCount: number;
  noPriceCost: number;
  /** Owing, priced, but at a figure that looks like bad data. */
  suspectCount: number;
};

/**
 * Everything owing across the whole book.
 *
 * Read-only, and the reason this screen exists: `nextBillablePeriod` has been
 * right all along but was only ever called from one website's page, so being
 * proactive meant opening 266 of them.
 *
 * Grouped by client and then by website because that's how these actually go
 * out — invoice 7347 carries four hosting lines for four different sites of one
 * client. The invoice unit is the client; the website is a heading inside it.
 */
export async function billingRun(): Promise<BillingRunResult> {
  await requireUser();

  const [services, clients, websites, itemPrices] = await Promise.all([
    prisma.recurringService.findMany({
      where: { active: true, clientId: { not: null }, client: { isInternal: false } },
      select: BILLABLE_SELECT,
    }),
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.website.findMany({ select: { id: true, name: true } }),
    itemPriceMap(),
  ]);

  const lines = toBillableLines(services, {
    itemPrices,
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
    websiteNames: new Map(websites.map((w) => [w.id, w.name])),
  });

  const owing = lines.filter((l) => !l.nothingOwing);
  const billable = owing.filter((l) => !l.noPrice && !l.priceLooksWrong);
  const unpriced = owing.filter((l) => l.noPrice);
  const suspect = owing.filter((l) => l.priceLooksWrong);

  // Suspect rows still appear under their client so the problem is visible —
  // they just can't be ticked.
  const byClient = new Map<string, BillableLine[]>();
  for (const l of [...billable, ...suspect]) {
    const bucket = byClient.get(l.clientId);
    if (bucket) bucket.push(l);
    else byClient.set(l.clientId, [l]);
  }

  const groups: ClientGroup[] = [];
  for (const [clientId, clientLines] of byClient) {
    const bySite = new Map<string, BillableLine[]>();
    for (const l of clientLines) {
      const key = l.websiteId ?? "";
      const bucket = bySite.get(key);
      if (bucket) bucket.push(l);
      else bySite.set(key, [l]);
    }

    groups.push({
      clientId,
      clientName: clientLines[0].clientName,
      sites: [...bySite.entries()]
        .map(([websiteId, siteLines]) => ({
          websiteId: websiteId || null,
          websiteName: siteLines[0].websiteName ?? "Not attached to a site",
          lines: siteLines.sort((a, b) => a.daysUntilStart - b.daysUntilStart),
        }))
        .sort((a, b) => a.websiteName.localeCompare(b.websiteName)),
      total: clientLines.filter((l) => !l.priceLooksWrong).reduce((n, l) => n + l.lineTotal, 0),
      overdue: clientLines.filter((l) => !l.advance).length,
      dueSoon: clientLines.filter((l) => l.advance).length,
      belowCost: clientLines.filter((l) => l.belowCost).length,
    });
  }

  // Overdue first, then by what's at stake — the order you'd work the list in.
  groups.sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  return {
    groups,
    overdueCount: billable.filter((l) => !l.advance).length,
    overdueValue: billable.filter((l) => !l.advance).reduce((n, l) => n + l.lineTotal, 0),
    dueSoonCount: billable.filter((l) => l.advance).length,
    dueSoonValue: billable.filter((l) => l.advance).reduce((n, l) => n + l.lineTotal, 0),
    noPriceCount: unpriced.length,
    noPriceCost: unpriced.reduce((n, l) => n + l.annualCost, 0),
    suspectCount: suspect.length,
  };
}

/**
 * Raise one draft for a client, covering the ticked services across their sites.
 *
 * Re-derives the billable set server-side rather than trusting the posted
 * amounts: the browser sends which services to bill, never what they cost.
 */
export async function raiseClientInvoice(clientId: string, formData: FormData): Promise<void> {
  await requireUser();

  const picked = new Set(formData.getAll("service").map(String).filter(Boolean));
  const back = "/invoices/run";
  if (!picked.size) redirect(`${back}?runError=${encodeURIComponent("Nothing selected.")}`);

  if (!(await getConnection())) {
    redirect(`${back}?runError=${encodeURIComponent("Xero is not connected.")}`);
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) redirect(`${back}?runError=${encodeURIComponent("Client not found.")}`);

  const [services, websites, itemPrices] = await Promise.all([
    prisma.recurringService.findMany({
      where: { id: { in: [...picked] }, clientId, active: true },
      select: BILLABLE_SELECT,
    }),
    prisma.website.findMany({ select: { id: true, name: true } }),
    itemPriceMap(),
  ]);

  const lines = toBillableLines(services, {
    itemPrices,
    clientNames: new Map([[client.id, client.name]]),
    websiteNames: new Map(websites.map((w) => [w.id, w.name])),
  }).filter((l) => !l.nothingOwing);

  const reference = String(formData.get("reference") ?? "").trim() || "Renewals";

  let result;
  try {
    result = await raiseInvoiceFor(client, lines, reference, ensureXeroContactForClient);
  } catch (e) {
    redirect(`${back}?runError=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }

  revalidatePath(back);
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");
  revalidatePath(`/clients/${clientId}`);

  redirect(
    `${back}?raised=${result.billed}&client=${encodeURIComponent(client.name)}&number=${encodeURIComponent(
      result.invoice.InvoiceNumber ?? ""
    )}&xid=${encodeURIComponent(result.invoice.InvoiceID)}`
  );
}
