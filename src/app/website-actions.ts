"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { matchInvoiceLines, toMatchableLine, type MatchableService } from "@/lib/billing-match";
import { applyLink, applyLinks } from "@/lib/billing-apply";
import { syncClientInvoiceLines } from "@/modules/accounting/xero/invoice-lines";
import { domainOf } from "@/lib/websites";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const opt = (fd: FormData, key: string) => str(fd, key) || null;

/**
 * How recently a client's invoice history must have been pulled for a website
 * scan to reuse it rather than call Xero again. Invoices don't change minute to
 * minute, and one client can own a dozen websites.
 */
const SYNC_REUSE_MS = 15 * 60_000;

function revalidateWebsite(websiteId: string, clientId?: string | null) {
  revalidatePath("/websites");
  revalidatePath(`/websites/${websiteId}`);
  revalidatePath("/recurring");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/* ---------- Bulk creation from domains ---------- */

/**
 * One row of the bulk builder: either a website to create, or an existing one
 * to join. `websiteId` is what tells the two apart.
 */
type BulkRow = {
  websiteId?: string | null;
  name?: string;
  url?: string | null;
  clientId?: string | null;
  serviceIds: string[];
};

/**
 * Apply the bulk builder's rows: create the new websites, join the existing ones.
 *
 * Only ever creates websites and fills in a service's *empty* websiteId — an
 * existing grouping is never rewritten, so a bad run is undone by detaching or
 * by deleting the websites it made (which detaches rather than cascades).
 */
export async function createWebsitesFromDomains(formData: FormData): Promise<void> {
  await requireUser();

  let rows: BulkRow[];
  try {
    rows = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    redirect("/websites/bulk?error=badpayload");
  }
  if (!Array.isArray(rows)) redirect("/websites/bulk?error=badpayload");

  let created = 0;
  let joined = 0;
  let attached = 0;
  let assigned = 0;

  for (const row of rows) {
    const serviceIds = Array.isArray(row.serviceIds) ? row.serviceIds : [];
    if (serviceIds.length === 0) continue;

    let websiteId: string;
    let clientId: string | null;

    if (row.websiteId) {
      // Joining a site that already exists: it owns the name and the client, so
      // nothing about it is modified — the domains just move under it.
      const target = await prisma.website.findUnique({ where: { id: row.websiteId } });
      if (!target) continue;
      websiteId = target.id;
      clientId = target.clientId;
      joined++;
    } else {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      clientId = row.clientId || null;
      const website = await prisma.website.create({
        data: { name, url: row.url || null, clientId },
      });
      websiteId = website.id;
      created++;
    }

    const result = await prisma.recurringService.updateMany({
      where: { id: { in: serviceIds }, websiteId: null },
      data: { websiteId },
    });
    attached += result.count;

    if (clientId) {
      const claimed = await prisma.recurringService.updateMany({
        where: { id: { in: serviceIds }, clientId: null },
        data: { clientId },
      });
      assigned += claimed.count;
    }
  }

  revalidatePath("/websites");
  revalidatePath("/recurring");
  revalidatePath("/clients");
  redirect(
    `/websites?created=${created}&joined=${joined}&attached=${attached}&assigned=${assigned}`
  );
}

/**
 * Create a website by hand and go straight to it.
 *
 * Separate from `createWebsite` on the client page, which stays on that page
 * because it's adding a site to a client you're already editing. Coming from
 * the websites list the useful next step is the new site itself, where services
 * get attached.
 */
export async function createWebsiteManually(formData: FormData): Promise<void> {
  await requireUser();

  const name = str(formData, "name");
  if (!name) redirect("/websites/new?error=" + encodeURIComponent("Give the website a name."));

  const clientId = opt(formData, "clientId");
  const url = opt(formData, "url");

  // Names are how sites are recognised across imports and matching, so a
  // duplicate is worth stopping rather than quietly creating a second record
  // that splits one site's services in two.
  //
  // Compared in JS rather than the query: SQLite has no case-insensitive
  // `equals` through Prisma, and "Example.co.uk" and "example.co.uk" are the
  // same site. Matched on the full registrable domain, not `siteKey` — that
  // keys on the label below the suffix, which is right for *grouping*
  // aberdashery.co.uk with aberdashery.com but would wrongly call them
  // duplicates here. A name with no domain in it falls back to a plain
  // case-insensitive comparison.
  const key = domainOf(name).toLowerCase() || name.trim().toLowerCase();
  const existing = (
    await prisma.website.findMany({ select: { id: true, name: true } })
  ).find((w) => (domainOf(w.name).toLowerCase() || w.name.trim().toLowerCase()) === key);
  if (existing) {
    redirect(
      `/websites/${existing.id}?error=` +
        encodeURIComponent(`A website called "${name}" already exists — this is it.`)
    );
  }

  const site = await prisma.website.create({
    data: { name, clientId, url, notes: opt(formData, "notes") },
  });

  revalidatePath("/websites");
  revalidatePath("/recurring");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  redirect(`/websites/${site.id}?created=1`);
}

/* ---------- Client assignment ---------- */

/**
 * Point a website at a client, and carry its services across.
 *
 * Services already assigned to a *different* client are left alone and counted
 * — silently moving someone else's billable item is how you invoice the wrong
 * person.
 */
async function applyClient(websiteId: string, clientId: string | null): Promise<number> {
  const before = await prisma.website.findUnique({ where: { id: websiteId } });
  await prisma.website.update({ where: { id: websiteId }, data: { clientId } });
  if (before?.clientId && before.clientId !== clientId) revalidatePath(`/clients/${before.clientId}`);
  if (!clientId) return 0;

  const moved = await prisma.recurringService.updateMany({
    where: { websiteId, clientId: null },
    data: { clientId },
  });
  return moved.count;
}

export async function assignWebsiteToClient(websiteId: string, formData: FormData) {
  await requireUser();
  const clientId = opt(formData, "clientId");
  await applyClient(websiteId, clientId);
  revalidateWebsite(websiteId, clientId);
}

/** Same thing, called directly from the table's inline picker (no form to submit). */
export async function setWebsiteClient(websiteId: string, clientId: string | null): Promise<number> {
  await requireUser();
  const moved = await applyClient(websiteId, clientId);
  revalidateWebsite(websiteId, clientId);
  return moved;
}

/** The websites table's "assign the ticked rows to one client" action. */
export async function assignWebsitesToClient(formData: FormData): Promise<void> {
  await requireUser();
  const clientId = opt(formData, "clientId");
  const websiteIds = formData.getAll("websiteId").map(String).filter(Boolean);
  if (!clientId || websiteIds.length === 0) redirect("/websites");

  let services = 0;
  for (const id of websiteIds) services += await applyClient(id, clientId);

  revalidatePath("/websites");
  revalidatePath("/recurring");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/websites?assigned=${websiteIds.length}&services=${services}`);
}

/* ---------- Attaching services ---------- */

/** Attach loose services to a website; they inherit its client if they have none. */
export async function attachServicesToWebsite(websiteId: string, formData: FormData) {
  await requireUser();
  const serviceIds = formData.getAll("serviceId").map(String).filter(Boolean);
  if (serviceIds.length === 0) return;

  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) return;

  await prisma.recurringService.updateMany({
    where: { id: { in: serviceIds } },
    data: { websiteId },
  });
  if (website.clientId) {
    await prisma.recurringService.updateMany({
      where: { id: { in: serviceIds }, clientId: null },
      data: { clientId: website.clientId },
    });
  }
  revalidateWebsite(websiteId, website.clientId);
}

/** Delete from the website's own page — there's nowhere to stay, so go to the list. */
export async function deleteWebsiteAndReturn(websiteId: string): Promise<void> {
  await requireUser();
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) redirect("/websites");
  // Detach rather than cascade — the services are the billable things.
  await prisma.recurringService.updateMany({ where: { websiteId }, data: { websiteId: null } });
  await prisma.website.delete({ where: { id: websiteId } });
  revalidatePath("/websites");
  revalidatePath("/recurring");
  if (site.clientId) revalidatePath(`/clients/${site.clientId}`);
  redirect("/websites?deleted=1");
}

export async function detachServiceFromWebsite(serviceId: string) {
  await requireUser();
  const service = await prisma.recurringService.findUnique({ where: { id: serviceId } });
  if (!service?.websiteId) return;
  const websiteId = service.websiteId;
  await prisma.recurringService.update({ where: { id: serviceId }, data: { websiteId: null } });
  revalidateWebsite(websiteId, service.clientId);
}

/* ---------- Invoice reconciliation ---------- */

export type ScanResult = {
  /** False when a precondition stopped it before any matching happened. */
  ran: boolean;
  /** True when this client's history was already fresh, so Xero wasn't called. */
  reusedCache: boolean;
  invoicesFetched: number;
  linesFetched: number;
  autoLinked: number;
  pending: number;
  error?: string;
};

/**
 * Refresh this website's client from Xero, then link what can be linked safely.
 *
 * Only unambiguous matches raised near the renewal are written; everything else
 * is left for the review queue the page renders, so nothing is silently
 * attributed to the wrong period or the wrong service.
 */
export async function scanWebsiteInvoices(websiteId: string): Promise<ScanResult> {
  await requireUser();
  const empty: ScanResult = {
    ran: false,
    reusedCache: false,
    invoicesFetched: 0,
    linesFetched: 0,
    autoLinked: 0,
    pending: 0,
  };

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: { client: true, services: true },
  });
  if (!website) return { ...empty, error: "Website not found." };
  if (!website.clientId || !website.client) {
    return { ...empty, error: "Assign this website to a client first." };
  }
  if (website.services.length === 0) {
    return { ...empty, error: "No services attached to match against." };
  }

  let invoicesFetched = 0;
  let linesFetched = 0;
  let reusedCache = false;
  let error: string | undefined;

  if (website.client.xeroContactId) {
    // Several websites usually belong to one client, and this pulls the whole
    // client's history — so scanning them one after another would refetch the
    // same invoices each time. Xero's daily budget is finite, so if we already
    // pulled this client's history minutes ago, match against that instead.
    const recent = await prisma.xeroInvoiceLine.findFirst({
      where: { clientId: website.clientId, syncedAt: { gte: new Date(Date.now() - SYNC_REUSE_MS) } },
      select: { syncedAt: true },
    });

    if (recent) {
      reusedCache = true;
    } else {
      try {
        const synced = await syncClientInvoiceLines(website.clientId, website.client.xeroContactId);
        invoicesFetched = synced.invoices;
        linesFetched = synced.lines;
      } catch (e) {
        // Carry on with what's already cached — a Xero outage shouldn't stop you
        // reconciling the history you've already pulled down.
        error = `Couldn't refresh from Xero (${e instanceof Error ? e.message : String(e)}) — matched against the cached history instead.`;
      }
    }
  }

  const lines = await prisma.xeroInvoiceLine.findMany({
    where: { clientId: website.clientId, reviewed: false },
    orderBy: { invoiceDate: "desc" },
  });

  const services: MatchableService[] = website.services.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    quantity: s.quantity,
    costPrice: s.costPrice,
    sellPrice: s.sellPrice,
    renewalDate: s.renewalDate,
    termMonths: s.termMonths,
  }));

  const { proposals } = matchInvoiceLines(lines.map(toMatchableLine), services);

  const { linked: autoLinked } = await applyLinks(
    proposals.filter((p) => p.auto).map((p) => ({ lineId: p.lineId, serviceId: p.serviceId })),
    "AUTO"
  );

  revalidateWebsite(websiteId, website.clientId);
  return {
    ran: true,
    reusedCache,
    invoicesFetched,
    linesFetched,
    autoLinked,
    pending: proposals.length - autoLinked,
    error,
  };
}

/** Form wrapper — runs the scan and reports the outcome via the URL. */
export async function scanWebsiteInvoicesAction(websiteId: string): Promise<void> {
  const r = await scanWebsiteInvoices(websiteId);
  const params = new URLSearchParams({
    scanned: r.ran ? "1" : "",
    invoices: String(r.invoicesFetched),
    lines: String(r.linesFetched),
    linked: String(r.autoLinked),
    pending: String(r.pending),
    cached: r.reusedCache ? "1" : "",
  });
  if (r.error) params.set("scanError", r.error);
  redirect(`/websites/${websiteId}?${params.toString()}`);
}

export async function linkInvoiceLineToService(
  lineId: string,
  websiteId: string,
  formData: FormData
) {
  await requireUser();
  const serviceId = str(formData, "serviceId");
  if (!serviceId) return;
  const service = await applyLink(lineId, serviceId, "MANUAL");
  revalidateWebsite(websiteId, service?.clientId);
}

/** Dismiss a line so it stops being offered — it isn't one of ours. */
export async function ignoreInvoiceLine(lineId: string, websiteId: string) {
  await requireUser();
  await prisma.xeroInvoiceLine.update({
    where: { id: lineId },
    data: { reviewed: true, recurringServiceId: null },
  });
  revalidateWebsite(websiteId);
}

/** Undo a link — removes the billing record it created and re-opens the line. */
export async function unlinkInvoiceLine(lineId: string, websiteId: string) {
  await requireUser();
  const line = await prisma.xeroInvoiceLine.findUnique({ where: { id: lineId } });
  if (!line) return;

  if (line.recurringServiceId) {
    await prisma.serviceBilling.deleteMany({
      where: {
        recurringServiceId: line.recurringServiceId,
        xeroInvoiceId: line.xeroInvoiceId,
        xeroLineIndex: line.lineIndex,
      },
    });
  }
  await prisma.xeroInvoiceLine.update({
    where: { id: lineId },
    data: { recurringServiceId: null, reviewed: false },
  });
  revalidateWebsite(websiteId, line.clientId);
}
