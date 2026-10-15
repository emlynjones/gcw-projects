"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getConnection } from "@/lib/xero";
import { resnapServiceBillings } from "@/lib/billing-apply";
import { periodFrom, isBillable } from "@/lib/recurring";
import { recurringDescription } from "@/lib/invoice-descriptions";
import {
  BILLABLE_SELECT,
  itemPriceMap,
  toBillableLines,
  raiseInvoiceFor,
  type BillableLine,
} from "@/lib/billing-raise";
import { ensureContactForClient } from "@/app/xero-actions";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

/**
 * What could go on an invoice for this website right now.
 *
 * Read-only. Services already billed for their current period, and those with
 * no sell price, are returned flagged rather than filtered out: "everything
 * here is already invoiced" is a useful answer, and a silently shortened list
 * looks like a bug.
 */
export async function billableServices(websiteId: string): Promise<BillableLine[]> {
  await requireUser();

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: {
      id: true,
      name: true,
      clientId: true,
      client: { select: { name: true, isInternal: true } },
      services: { where: { active: true }, orderBy: [{ kind: "asc" }, { label: "asc" }], select: BILLABLE_SELECT },
    },
  });
  if (!website?.clientId || website.client?.isInternal) return [];

  return toBillableLines(website.services, {
    itemPrices: await itemPriceMap(),
    clientNames: new Map([[website.clientId, website.client?.name ?? ""]]),
    websiteNames: new Map([[website.id, website.name]]),
  });
}

/**
 * Raise one draft covering specific periods, ticked on the period grid.
 *
 * Distinct from `raiseWebsiteInvoice`, which bills whatever each service owes
 * next. Here the period is chosen: a year that was renewed and never passed on
 * can be billed years later, without pretending it's the current term. Each
 * submitted value is `serviceId|periodStartISO`.
 */
export async function raisePeriodInvoice(websiteId: string, formData: FormData): Promise<void> {
  await requireUser();

  const back = `/websites/${websiteId}`;
  const picked = formData
    .getAll("period")
    .map(String)
    .map((v) => {
      const [serviceId, iso] = v.split("|");
      return { serviceId, start: new Date(iso) };
    })
    .filter((x) => x.serviceId && !Number.isNaN(x.start.getTime()));

  if (!picked.length) redirect(`${back}?invoiceError=${encodeURIComponent("Nothing selected.")}`);
  if (!(await getConnection())) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Xero is not connected.")}`);
  }

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, clientId: true, client: true },
  });
  if (!website?.client) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Assign this website to a client first.")}`);
  }
  if (website.client.isInternal) {
    redirect(`${back}?invoiceError=${encodeURIComponent("This client is marked as us and cannot be invoiced.")}`);
  }

  const services = await prisma.recurringService.findMany({
    where: { id: { in: picked.map((p) => p.serviceId) }, websiteId, active: true },
    select: BILLABLE_SELECT,
  });
  const itemPrices = await itemPriceMap();

  // Build a line per ticked period, priced and described for *that* term rather
  // than for whatever is currently due.
  const lines: BillableLine[] = [];
  for (const { serviceId, start } of picked) {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc || !isBillable(svc)) continue;

    const period = periodFrom(start, svc.termMonths || 12);
    const base = toBillableLines([svc], {
      itemPrices,
      clientNames: new Map([[website.clientId!, website.client.name]]),
      websiteNames: new Map([[website.id, website.name]]),
    })[0];
    if (!base || base.noPrice || base.priceLooksWrong) continue;

    lines.push({
      ...base,
      periodStart: period.start,
      periodEnd: period.end,
      description: recurringDescription(svc.kind, svc.label, period, svc.quantity),
      nothingOwing: false,
    });
  }

  if (!lines.length) {
    redirect(
      `${back}?invoiceError=${encodeURIComponent(
        "Nothing there could be invoiced — check the sell prices."
      )}`
    );
  }

  const reference = String(formData.get("reference") ?? "").trim() || website.name;

  let result;
  try {
    result = await raiseInvoiceFor(website.client, lines, reference, ensureContactForClient);
  } catch (e) {
    redirect(`${back}?invoiceError=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }

  revalidatePath(back);
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");
  revalidatePath("/invoices/run");
  if (website.clientId) revalidatePath(`/clients/${website.clientId}`);

  redirect(
    `${back}?invoiced=${result.billed}&number=${encodeURIComponent(
      result.invoice.InvoiceNumber ?? ""
    )}&xid=${encodeURIComponent(result.invoice.InvoiceID)}`
  );
}

/**
 * Resolve a period without raising a new Xero invoice.
 *
 * MISSED is an explicit write-off; EXTERNAL means it was paid on another line
 * or invoice (for example extra storage bundled into hosting). Both count as
 * covered for deciding what term is due next, but remain visibly different
 * from a real invoice in the period grid.
 */
export async function resolveBillingPeriod(
  websiteId: string,
  formData: FormData
): Promise<void> {
  await requireUser();
  const serviceId = String(formData.get("serviceId") ?? "");
  const start = new Date(String(formData.get("start") ?? ""));
  const resolution = String(formData.get("resolution") ?? "");
  if (
    !serviceId ||
    Number.isNaN(start.getTime()) ||
    (resolution !== "MISSED" && resolution !== "EXTERNAL")
  ) {
    throw new Error("Invalid period resolution");
  }

  const service = await prisma.recurringService.findFirst({
    where: { id: serviceId, websiteId },
    select: { id: true, termMonths: true, clientId: true },
  });
  if (!service) throw new Error("Service not found on this website");

  const period = periodFrom(start, service.termMonths || 12);
  await prisma.serviceBilling.upsert({
    where: {
      recurringServiceId_periodStart: {
        recurringServiceId: service.id,
        periodStart: period.start,
      },
    },
    update: {
      periodEnd: period.end,
      amount: 0,
      xeroInvoiceId: null,
      xeroNumber: null,
      xeroStatus: null,
      xeroLineIndex: null,
      matchedBy: resolution,
    },
    create: {
      recurringServiceId: service.id,
      periodStart: period.start,
      periodEnd: period.end,
      amount: 0,
      matchedBy: resolution,
    },
  });

  revalidatePath(`/websites/${websiteId}`);
  revalidatePath("/recurring");
  revalidatePath("/recurring/dashboard");
  revalidatePath("/reports/recurring");
  revalidatePath("/invoices/run");
  if (service.clientId) revalidatePath(`/clients/${service.clientId}`);
}

/**
 * Move an invoice from one billing period to another.
 *
 * Needed because raising for the wrong year is easy and, until now, permanent:
 * the period a billing sits in was only ever set when it was created, so an
 * invoice raised against last year kept that year looking billed and left the
 * one it was really for looking like a gap — two errors from one slip.
 *
 * When the target period already has a billing the two are **swapped** rather
 * than one overwriting the other. Getting a pair of invoices the wrong way round
 * is the common version of this mistake, and a swap fixes it in one move without
 * ever destroying a record. `(recurringServiceId, periodStart)` is unique, so
 * the exchange goes through a parked value inside one transaction.
 *
 * Only the allocation changes. The invoice in Xero still says whatever it said,
 * so a draft whose wording names the old dates needs editing there too — this
 * can't rewrite someone's accounting record for them.
 */
export async function moveBillingPeriod(
  websiteId: string,
  formData: FormData
): Promise<void> {
  await requireUser();
  const back = `/websites/${websiteId}`;

  const serviceId = String(formData.get("serviceId") ?? "");
  const fromIso = String(formData.get("from") ?? "");
  const toIso = String(formData.get("to") ?? "");
  const from = new Date(fromIso);
  const to = new Date(toIso);

  if (!serviceId || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Couldn't work out which period to move.")}`);
  }
  if (from.getTime() === to.getTime()) redirect(back);

  const service = await prisma.recurringService.findUnique({
    where: { id: serviceId },
    select: { id: true, label: true, termMonths: true, websiteId: true, clientId: true },
  });
  if (!service || service.websiteId !== websiteId) {
    redirect(`${back}?invoiceError=${encodeURIComponent("That service isn't on this website.")}`);
  }

  const [moving, sitting] = await Promise.all([
    prisma.serviceBilling.findUnique({
      where: { recurringServiceId_periodStart: { recurringServiceId: serviceId, periodStart: from } },
    }),
    prisma.serviceBilling.findUnique({
      where: { recurringServiceId_periodStart: { recurringServiceId: serviceId, periodStart: to } },
    }),
  ]);
  if (!moving) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Nothing is allocated to that period.")}`);
  }

  const term = service.termMonths || 12;
  const target = periodFrom(to, term);
  const source = periodFrom(from, term);

  await prisma.$transaction(async (tx) => {
    if (!sitting) {
      // A plain move: delete and recreate, because the period start is half the
      // primary key and can't simply be updated.
      await tx.serviceBilling.delete({ where: { id: moving.id } });
      await tx.serviceBilling.create({
        data: {
          recurringServiceId: serviceId,
          periodStart: target.start,
          periodEnd: target.end,
          amount: moving.amount,
          xeroInvoiceId: moving.xeroInvoiceId,
          xeroNumber: moving.xeroNumber,
          xeroStatus: moving.xeroStatus,
          xeroLineIndex: moving.xeroLineIndex,
          matchedBy: "MANUAL",
        },
      });
      return;
    }

    // A swap. Park one row on a period nothing can occupy — a century back —
    // so neither half of the exchange collides with the unique key mid-flight.
    const parked = new Date(from);
    parked.setFullYear(parked.getFullYear() - 100);

    await tx.serviceBilling.update({ where: { id: moving.id }, data: { periodStart: parked } });
    await tx.serviceBilling.update({
      where: { id: sitting.id },
      data: { periodStart: source.start, periodEnd: source.end, matchedBy: "MANUAL" },
    });
    await tx.serviceBilling.update({
      where: { id: moving.id },
      data: { periodStart: target.start, periodEnd: target.end, matchedBy: "MANUAL" },
    });
  });

  revalidatePath(back);
  revalidatePath("/recurring/dashboard");
  revalidatePath("/reports/recurring");
  revalidatePath("/invoices/run");
  if (service.clientId) revalidatePath(`/clients/${service.clientId}`);

  const what = sitting
    ? `Swapped ${moving.xeroNumber ?? "that invoice"} and ${sitting.xeroNumber ?? "the other"}`
    : `Moved ${moving.xeroNumber ?? "that invoice"}`;
  redirect(
    `${back}?realloc=${encodeURIComponent(what)}&to=${encodeURIComponent(
      target.start.toISOString().slice(0, 10)
    )}`
  );
}

/**
 * Remove an allocation without touching the invoice.
 *
 * For the case a swap doesn't cover: an invoice raised that shouldn't have been
 * at all. Unlinking leaves the period showing as unbilled again, which is the
 * honest state; voiding the invoice itself is a Xero job.
 */
export async function unallocateBilling(websiteId: string, formData: FormData): Promise<void> {
  await requireUser();
  const back = `/websites/${websiteId}`;

  const serviceId = String(formData.get("serviceId") ?? "");
  const from = new Date(String(formData.get("from") ?? ""));
  if (!serviceId || Number.isNaN(from.getTime())) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Couldn't work out which period to clear.")}`);
  }

  const billing = await prisma.serviceBilling.findUnique({
    where: { recurringServiceId_periodStart: { recurringServiceId: serviceId, periodStart: from } },
    select: { id: true, xeroNumber: true, xeroInvoiceId: true },
  });
  if (!billing) redirect(back);

  await prisma.$transaction([
    prisma.serviceBilling.delete({ where: { id: billing.id } }),
    // The invoice line, if one was matched, goes back in the review queue rather
    // than silently keeping a link to a period that no longer exists.
    prisma.xeroInvoiceLine.updateMany({
      where: { recurringServiceId: serviceId, xeroInvoiceId: billing.xeroInvoiceId ?? "" },
      data: { recurringServiceId: null, reviewed: false },
    }),
  ]);

  revalidatePath(back);
  revalidatePath("/recurring/dashboard");
  revalidatePath("/reports/recurring");
  redirect(
    `${back}?realloc=${encodeURIComponent(
      `Cleared ${billing.xeroNumber ?? "that allocation"} — the period shows as unbilled again`
    )}`
  );
}

/**
 * Re-derive a service's billing periods from its renewal date.
 *
 * The renewal date is deliberately left alone. It comes from the supplier's own
 * invoice and is the one figure here with an outside source — RawSAFE's was
 * corrected from a supplier invoice, and an earlier version of this screen
 * offered to overwrite it with a date inferred from our own billing history,
 * which would have undone that correction.
 *
 * The periods are the derived half, so they're what gets rebuilt. See
 * `resnapServiceBillings` for why a stale one can hide an unbilled year.
 */
export async function resnapBillingPeriods(
  websiteId: string,
  serviceId: string
): Promise<void> {
  await requireUser();

  const { moved } = await resnapServiceBillings(serviceId);
  const service = await prisma.recurringService.findUnique({
    where: { id: serviceId },
    select: { label: true, clientId: true },
  });

  revalidatePath(`/websites/${websiteId}`);
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");
  if (service?.clientId) revalidatePath(`/clients/${service.clientId}`);
  redirect(
    `/websites/${websiteId}?resnapped=${encodeURIComponent(service?.label ?? "")}&moved=${moved}`
  );
}

/**
 * Raise one draft invoice covering the ticked services.
 *
 * Deliberately one invoice with a line per service rather than an invoice each:
 * that's how these have always gone out — invoice 7080 carries four separate
 * domain renewals — and it's one thing for the client to pay.
 *
 * A `ServiceBilling` is written per line as part of the same operation. We know
 * exactly what was billed here, so there is nothing for the matcher to infer
 * later, and the service stops showing on the not-yet-billed report the moment
 * the draft exists.
 */
export async function raiseWebsiteInvoice(websiteId: string, formData: FormData): Promise<void> {
  await requireUser();

  const picked = new Set(formData.getAll("service").map(String).filter(Boolean));
  const back = `/websites/${websiteId}`;
  if (!picked.size) redirect(`${back}?invoiceError=${encodeURIComponent("Nothing selected.")}`);

  if (!(await getConnection())) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Xero is not connected.")}`);
  }

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, clientId: true, client: true },
  });
  if (!website?.client) {
    redirect(`${back}?invoiceError=${encodeURIComponent("Assign this website to a client first.")}`);
  }

  const lines = (await billableServices(websiteId)).filter(
    (l) => picked.has(l.id) && !l.nothingOwing
  );
  const reference = String(formData.get("reference") ?? "").trim() || website.name;

  let result;
  try {
    result = await raiseInvoiceFor(website.client, lines, reference, ensureContactForClient);
  } catch (e) {
    redirect(`${back}?invoiceError=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }

  revalidatePath(back);
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");
  revalidatePath("/invoices/run");
  if (website.clientId) revalidatePath(`/clients/${website.clientId}`);

  redirect(
    `${back}?invoiced=${result.billed}&number=${encodeURIComponent(
      result.invoice.InvoiceNumber ?? ""
    )}&xid=${encodeURIComponent(result.invoice.InvoiceID)}`
  );
}
