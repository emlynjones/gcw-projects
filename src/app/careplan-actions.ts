"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  discoverCarePlans,
  candidateAnnualValue,
  type CarePlanCandidate,
  type DiscoveryLine,
} from "@/lib/careplan-discovery";
import { applyLinks } from "@/lib/billing-apply";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

export type CarePlanRow = CarePlanCandidate & {
  clientName: string;
  /** Set when the named domain already belongs to a website here. */
  websiteId: string | null;
  websiteName: string | null;
  /** True when a CAREPLAN service already covers this client and price. */
  alreadyTracked: boolean;
};

export type CarePlanSummary = {
  rows: CarePlanRow[];
  clearCount: number;
  clearAnnualValue: number;
  /** Long-running plans that stopped recently — most likely missed billing. */
  lapsedCount: number;
  lapsedValue: number;
};

/**
 * Read the ledger and propose care-plan services.
 *
 * Read-only, so it can be re-run freely — nothing exists until a row is ticked.
 */
export async function buildCarePlanQueue(): Promise<CarePlanSummary> {
  await requireUser();

  const raw = await prisma.xeroInvoiceLine.findMany({
    where: { clientId: { not: null } },
    select: {
      id: true,
      clientId: true,
      description: true,
      reference: true,
      quantity: true,
      lineAmount: true,
      invoiceDate: true,
      xeroNumber: true,
      domains: true,
    },
  });

  const lines: DiscoveryLine[] = raw.map((l) => ({
    ...l,
    domains: l.domains ? (JSON.parse(l.domains) as string[]) : [],
  }));

  const candidates = discoverCarePlans(lines);

  const [clients, websites, existing] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.website.findMany({ select: { id: true, name: true, url: true } }),
    prisma.recurringService.findMany({
      where: { kind: "CAREPLAN" },
      select: { clientId: true, sellPrice: true },
    }),
  ]);

  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const siteByName = new Map<string, { id: string; name: string }>();
  for (const w of websites) {
    for (const key of [w.name, w.url ?? ""]) {
      const norm = key.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (norm) siteByName.set(norm, { id: w.id, name: w.name });
    }
  }
  const tracked = new Set(existing.map((s) => `${s.clientId}::${Math.round(s.sellPrice)}`));

  const rows: CarePlanRow[] = candidates.map((c) => {
    const site = c.domain ? siteByName.get(c.domain.toLowerCase()) : undefined;
    return {
      ...c,
      clientName: clientName.get(c.clientId) ?? "—",
      websiteId: site?.id ?? null,
      websiteName: site?.name ?? null,
      alreadyTracked: tracked.has(`${c.clientId}::${Math.round(c.monthlyPrice)}`),
    };
  });

  const open = rows.filter((r) => !r.alreadyTracked);
  const clear = open.filter((r) => r.confidence === "CLEAR");
  // A plan billed six times or more that has gone quiet in the last year is the
  // interesting case: too established to be a one-off, too recent to assume the
  // client left. That's where missed monthly billing hides.
  const lapsed = open.filter(
    (r) => r.occurrences >= 6 && r.monthsSinceLast >= 2 && r.monthsSinceLast <= 12
  );

  return {
    rows,
    clearCount: clear.length,
    clearAnnualValue: candidateAnnualValue(clear),
    lapsedCount: lapsed.length,
    lapsedValue: lapsed.reduce((n, r) => n + r.monthlyPrice * r.monthsSinceLast, 0),
  };
}

/**
 * Create services for the ticked candidates, and link their evidence.
 *
 * A care plan is our own labour rather than something bought in, so `costPrice`
 * stays at zero and the money question becomes "was this month billed?" rather
 * than margin. `termMonths` is 1: these bill twelve times a year, which is what
 * makes a missed month worth catching quickly.
 */
export async function createCarePlanServices(formData: FormData): Promise<void> {
  await requireUser();

  const picked = new Set(formData.getAll("create").map(String).filter(Boolean));
  if (!picked.size) redirect("/recurring/careplans");

  const { rows } = await buildCarePlanQueue();
  const chosen = rows.filter((r) => picked.has(r.key) && !r.alreadyTracked);
  if (!chosen.length) redirect("/recurring/careplans");

  let created = 0;
  const pairs: { lineId: string; serviceId: string }[] = [];

  for (const row of chosen) {
    // Anchor the renewal to the last charge so the monthly periods line up with
    // how it has actually been invoiced, not with the day the button was pressed.
    const service = await prisma.recurringService.create({
      data: {
        clientId: row.clientId,
        websiteId: row.websiteId,
        kind: "CAREPLAN",
        label: row.label,
        quantity: 1,
        costPrice: 0,
        costBasis: "ANNUAL",
        sellPrice: row.monthlyPrice,
        renewalDate: row.lastSeen,
        termMonths: 1,
        active: true,
        notes: `Found in invoice history: ${row.occurrences} charges, ${row.firstSeen
          .toISOString()
          .slice(0, 10)} to ${row.lastSeen.toISOString().slice(0, 10)}.`,
      },
    });
    created++;
    for (const lineId of row.lineIds) pairs.push({ lineId, serviceId: service.id });
  }

  // Booking the history at the same time is the point: a plan with no billings
  // reads as never invoiced, which is exactly the alarm we don't want to raise
  // for the ones that have been billed faithfully for years.
  const { linked } = await applyLinks(pairs, "AUTO");

  revalidatePath("/recurring");
  revalidatePath("/recurring/careplans");
  revalidatePath("/reports/recurring");

  redirect(`/recurring/careplans?created=${created}&linked=${linked}`);
}
