/**
 * Writing a confirmed invoice-line → service link.
 *
 * Kept out of the action files because three of them need it — the per-website
 * scan, the global review queue, and manual linking — and the sell-price rule
 * below is exactly the kind of thing that drifts when it's copied. There is one
 * place a billing record gets written, and this is it.
 */
import { prisma } from "@/lib/prisma";
import { periodForDate, periodFrom } from "@/lib/recurring";

export type MatchedBy = "AUTO" | "MANUAL" | "CREATED";

/**
 * Record that an invoice line paid for a service.
 *
 * The billing is keyed on the service's own renewal anniversary rather than the
 * invoice date, so running this twice updates one row instead of creating two —
 * that's what ServiceBilling's unique (service, periodStart) buys us.
 *
 * Returns the service, or null when either side has since been deleted.
 */
export async function applyLink(lineId: string, serviceId: string, matchedBy: MatchedBy) {
  const [line, service] = await Promise.all([
    prisma.xeroInvoiceLine.findUnique({ where: { id: lineId } }),
    prisma.recurringService.findUnique({ where: { id: serviceId } }),
  ]);
  if (!line || !service) return null;

  const period =
    periodForDate(service, line.invoiceDate) ??
    periodFrom(line.invoiceDate, service.termMonths || 12);

  const billing = {
    periodEnd: period.end,
    amount: line.lineAmount,
    xeroInvoiceId: line.xeroInvoiceId,
    xeroNumber: line.xeroNumber,
    xeroStatus: line.status,
    xeroLineIndex: line.lineIndex,
    matchedBy,
  };

  await prisma.serviceBilling.upsert({
    where: {
      recurringServiceId_periodStart: { recurringServiceId: serviceId, periodStart: period.start },
    },
    update: billing,
    create: { recurringServiceId: serviceId, periodStart: period.start, ...billing },
  });

  await prisma.xeroInvoiceLine.update({
    where: { id: lineId },
    data: { recurringServiceId: serviceId, reviewed: true },
  });

  await seedSellPrice(service, line);
  return service;
}

/**
 * Seed a missing sell price from what was actually charged.
 *
 * Only ever fills a £0, which is missing data rather than a decision — 429 of
 * the 440 services carry one, because the registers were imported from supplier
 * exports that know cost and nothing about what we charge. A price someone has
 * already entered is never overwritten; a disagreement is surfaced in the UI so
 * a human can judge it.
 */
async function seedSellPrice(
  service: { id: string; sellPrice: number; quantity: number },
  line: { quantity: number; lineAmount: number }
) {
  if (service.sellPrice !== 0) return;

  // A line covering 5 seats at £9 is a £45 line, and the service's price is per
  // seat — divide only when the quantities actually agree, otherwise the line
  // is for the whole thing.
  const qty =
    service.quantity > 0 && Math.abs(line.quantity - service.quantity) < 0.001
      ? service.quantity
      : 1;
  const unit = Math.round((line.lineAmount / qty) * 100) / 100;
  if (unit > 0) {
    await prisma.recurringService.update({ where: { id: service.id }, data: { sellPrice: unit } });
  }
}

/** Mark a line as genuine client work that does not pay for a recurring service. */
export async function applyOtherWorkLine(lineId: string) {
  await prisma.xeroInvoiceLine.update({
    where: { id: lineId },
    data: { reviewed: true, recurringServiceId: null },
  });
}

/** Rows per transaction — see applyLinks. */
const APPLY_CHUNK = 100;

/**
 * Apply many links at once.
 *
 * `applyLink` does four round trips per link, which is fine for one and ruinous
 * for hundreds: confirming a full queue of ~840 that way is ~3,400 sequential
 * statements, each its own SQLite commit. That holds the single write lock long
 * enough to time out every other request in the app — the same failure the
 * invoice index caused.
 *
 * So: read everything up front, compute in memory, and write in batched
 * transactions. Behaviour per link is identical to `applyLink`, including only
 * ever seeding a sell price that is currently £0.
 */
export async function applyLinks(
  pairs: { lineId: string; serviceId: string }[],
  matchedBy: MatchedBy
): Promise<{ linked: number; pricesSet: number }> {
  if (!pairs.length) return { linked: 0, pricesSet: 0 };

  const [lines, services] = await Promise.all([
    prisma.xeroInvoiceLine.findMany({ where: { id: { in: pairs.map((p) => p.lineId) } } }),
    prisma.recurringService.findMany({ where: { id: { in: pairs.map((p) => p.serviceId) } } }),
  ]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const ops: ReturnType<typeof prisma.xeroInvoiceLine.update>[] = [];
  // One service can gain a price from only one line — first wins, matching the
  // sequential behaviour where a later link finds sellPrice already non-zero.
  const priced = new Map<string, number>();
  let linked = 0;

  for (const { lineId, serviceId } of pairs) {
    const line = lineById.get(lineId);
    const service = serviceById.get(serviceId);
    if (!line || !service) continue;

    const period =
      periodForDate(service, line.invoiceDate) ??
      periodFrom(line.invoiceDate, service.termMonths || 12);

    const billing = {
      periodEnd: period.end,
      amount: line.lineAmount,
      xeroInvoiceId: line.xeroInvoiceId,
      xeroNumber: line.xeroNumber,
      xeroStatus: line.status,
      xeroLineIndex: line.lineIndex,
      matchedBy,
    };

    ops.push(
      prisma.serviceBilling.upsert({
        where: {
          recurringServiceId_periodStart: {
            recurringServiceId: serviceId,
            periodStart: period.start,
          },
        },
        update: billing,
        create: { recurringServiceId: serviceId, periodStart: period.start, ...billing },
      }) as never
    );
    ops.push(
      prisma.xeroInvoiceLine.update({
        where: { id: lineId },
        data: { recurringServiceId: serviceId, reviewed: true },
      })
    );
    linked++;

    if (service.sellPrice === 0 && !priced.has(serviceId)) {
      const qty =
        service.quantity > 0 && Math.abs(line.quantity - service.quantity) < 0.001
          ? service.quantity
          : 1;
      const unit = Math.round((line.lineAmount / qty) * 100) / 100;
      if (unit > 0) priced.set(serviceId, unit);
    }
  }

  for (const [id, sellPrice] of priced) {
    ops.push(prisma.recurringService.update({ where: { id }, data: { sellPrice } }) as never);
  }

  for (let i = 0; i < ops.length; i += APPLY_CHUNK) {
    await prisma.$transaction(ops.slice(i, i + APPLY_CHUNK));
  }

  return { linked, pricesSet: priced.size };
}

/** Mark many lines reviewed as non-recurring work in one go. */
export async function applyOtherWork(lineIds: string[]): Promise<number> {
  if (!lineIds.length) return 0;
  const r = await prisma.xeroInvoiceLine.updateMany({
    where: { id: { in: lineIds } },
    data: { reviewed: true, recurringServiceId: null },
  });
  return r.count;
}

/**
 * Re-derive a service's billing periods from its current renewal date.
 *
 * Billing periods aren't stored as written on the invoice — they're *derived*,
 * by snapping each invoice's date to the nearest anniversary of the renewal
 * date. So a renewal date that was wrong when the history was imported leaves
 * every period wrong with it, and correcting the date alone doesn't heal them.
 *
 * RawSAFE was the case that surfaced this: hosting invoiced "from 30th July
 * 2025 to 30th July 2026" four years running, but imported against a renewal
 * date of 1st September, producing periods a month out. The stale period then
 * overlapped the genuinely-unbilled year and hid a £225 renewal that was three
 * weeks overdue.
 *
 * Only billings traceable to an invoice line are moved — one raised by hand
 * has no invoice date to re-snap from, and inventing one would be worse than
 * leaving it.
 */
export async function resnapServiceBillings(serviceId: string): Promise<{ moved: number }> {
  const service = await prisma.recurringService.findUnique({
    where: { id: serviceId },
    select: { id: true, renewalDate: true, termMonths: true },
  });
  if (!service?.renewalDate) return { moved: 0 };

  const [billings, lines] = await Promise.all([
    prisma.serviceBilling.findMany({ where: { recurringServiceId: serviceId } }),
    prisma.xeroInvoiceLine.findMany({
      where: { recurringServiceId: serviceId },
      select: { xeroInvoiceId: true, lineIndex: true, invoiceDate: true },
    }),
  ]);

  const dateOf = new Map(lines.map((l) => [`${l.xeroInvoiceId}#${l.lineIndex}`, l.invoiceDate]));
  const ops = [];
  let moved = 0;

  for (const b of billings) {
    const invoiceDate =
      dateOf.get(`${b.xeroInvoiceId}#${b.xeroLineIndex}`) ??
      // Older rows may predate line-index tracking; fall back to any line on
      // the same invoice before giving up on the row.
      lines.find((l) => l.xeroInvoiceId === b.xeroInvoiceId)?.invoiceDate;
    if (!invoiceDate) continue;

    const period = periodForDate(service, invoiceDate);
    if (!period) continue;

    const sameStart = period.start.getTime() === b.periodStart.getTime();
    const sameEnd = period.end.getTime() === b.periodEnd.getTime();
    if (sameStart && sameEnd) continue;

    // A longer term commonly keeps the same anniversary. Extend the stored
    // coverage even when the allocation does not need to move.
    if (sameStart) {
      ops.push(
        prisma.serviceBilling.update({
          where: { id: b.id },
          data: { periodEnd: period.end },
        })
      );
      moved++;
      continue;
    }

    // The unique key is (service, periodStart), so a move is a delete plus a
    // create rather than an update — and a period that now collides with an
    // existing row is dropped, since two invoices landing on one period means
    // one of them was double-counted.
    ops.push(prisma.serviceBilling.delete({ where: { id: b.id } }));
    ops.push(
      prisma.serviceBilling.upsert({
        where: {
          recurringServiceId_periodStart: {
            recurringServiceId: serviceId,
            periodStart: period.start,
          },
        },
        update: { periodEnd: period.end },
        create: {
          recurringServiceId: serviceId,
          periodStart: period.start,
          periodEnd: period.end,
          amount: b.amount,
          xeroInvoiceId: b.xeroInvoiceId,
          xeroNumber: b.xeroNumber,
          xeroStatus: b.xeroStatus,
          xeroLineIndex: b.xeroLineIndex,
          matchedBy: b.matchedBy,
        },
      })
    );
    moved++;
  }

  if (ops.length) await prisma.$transaction(ops);
  return { moved };
}
