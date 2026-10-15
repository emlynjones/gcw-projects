/**
 * A recurring service seen as a run of billing periods.
 *
 * The flat billing log answered "what got invoiced" but not the question that
 * matters: *which years of this domain have we charged for, and which did we
 * pay for and never pass on?* A list of invoices makes a missing year look like
 * nothing at all — an absence you have to notice. Laid out as consecutive
 * periods, the gap is a hole you can see.
 *
 * Everything is derived from `renewalDate` + `termMonths`, like the rest of the
 * model; nothing new is stored.
 */

import {
  addMonths,
  periodFrom,
  currentPeriod,
  nextBillablePeriod,
  isCancelled,
  type Period,
} from "@/lib/recurring";

export type PeriodState =
  /** Invoiced — a billing record covers it. */
  | "BILLED"
  /** Deliberately not charged; closes the term without inventing an invoice. */
  | "MISSED"
  /** Charged outside this service line, such as storage bundled into hosting. */
  | "EXTERNAL"
  /**
   * Running or past, with nothing covering it, on a service we *have* billed in
   * other years. A year demonstrably skipped — this is the money that leaks.
   */
  | "GAP"
  /**
   * Same shape, but on a service with no billing history at all. Across the
   * estate that's 202 services against 44 with a real skipped year, and the two
   * mean very different things: one is a year we know was missed, the other is
   * a service never matched to any invoice. Calling both "never billed" would
   * put £16k of alarm next to £3k of fact and teach you to ignore the colour.
   */
  | "UNKNOWN"
  /** The next term, close enough to bill ahead of the renewal. */
  | "DUE"
  /** Beyond the advance window — not a decision yet. */
  | "FUTURE"
  /** The service was cancelled, so this term will never happen. */
  | "CANCELLED";

export type ServicePeriod = {
  start: Date;
  end: Date;
  /** Calendar year the term starts in — the column this lands in. */
  year: number;
  state: PeriodState;
  amount: number | null;
  xeroInvoiceId: string | null;
  xeroNumber: string | null;
  xeroStatus: string | null;
};

export type PeriodRow = {
  serviceId: string;
  kind: string;
  label: string;
  quantity: number;
  managedBy: string;
  /** Term length, so a non-annual cycle can say so. */
  termMonths: number;
  cancelled: boolean;
  periods: ServicePeriod[];
  /** Years skipped on a service billed in other years. */
  gaps: number;
  /** Periods on a service with no billing record at all. */
  unknown: number;
};

export type PeriodGrid = {
  years: number[];
  rows: PeriodRow[];
  totalGaps: number;
  totalUnknown: number;
};

type Billing = {
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  xeroInvoiceId: string | null;
  xeroNumber: string | null;
  xeroStatus: string | null;
  matchedBy: string;
};

type Svc = {
  id: string;
  kind: string;
  label: string;
  quantity: number;
  managedBy: string;
  renewalDate: Date | null;
  termMonths: number;
  cancelledAt?: Date | null;
  billings: Billing[];
};

/** How far back the grid reaches. Five years covers the ledger's useful memory. */
export const GRID_YEARS = 5;

/**
 * A billing counts as covering a period when it overlaps it substantially.
 *
 * Not any overlap: a renewal date corrected by a month leaves the old period
 * touching the new one at the edge, and treating that as covered is exactly how
 * RawSAFE's unbilled year stayed hidden. Half the term is a wide enough margin
 * to absorb a few days' drift without swallowing a whole missing year.
 */
function covers(b: Billing, p: Period): boolean {
  const overlap =
    Math.min(b.periodEnd.getTime(), p.end.getTime()) -
    Math.max(b.periodStart.getTime(), p.start.getTime());
  return overlap >= (p.end.getTime() - p.start.getTime()) / 2;
}

/**
 * Build the period run for one service, oldest first.
 *
 * The run never starts before there's evidence the service was ours to bill.
 * Reaching a fixed five years back invents gaps: a domain first invoiced in
 * 2022 would show 2021 as unbilled, when there was simply nothing to bill. So
 * the history starts at the earliest billing on record (capped at the window,
 * for the ones going back further), and a service with no history at all starts
 * at its current term — an empty past we can't speak to is not a gap.
 */
export function servicePeriods(service: Svc, now: Date = new Date(), years = GRID_YEARS): ServicePeriod[] {
  if (!service.renewalDate) return [];
  const term = service.termMonths || 12;
  // Monthly things (care plans) would be sixty cells wide and aren't what this
  // view is for.
  if (term < 12) return [];

  const upcoming = nextBillablePeriod(service, service.billings, now);

  // The term containing today. Must come from `currentPeriod`, which rolls a
  // stale renewal date forward: walking only backwards from the stored date
  // leaves a service whose date is in the past sitting on a term that has
  // already ended, so its whole row lands a year left of everything else.
  const current = currentPeriod(service, now);
  if (!current) return [];

  const earliestBilling = service.billings.reduce<Date | null>(
    (a, b) => (!a || b.periodStart < a ? b.periodStart : a),
    null
  );
  const windowStart = addMonths(current.start, -term * (years - 1));
  const from = earliestBilling
    ? earliestBilling > windowStart
      ? earliestBilling
      : windowStart
    : current.start;

  const out: ServicePeriod[] = [];
  let p = current;
  while (p.start > from) p = periodFrom(addMonths(p.start, -term), term);

  // One term past the current one, so a renewal coming up is visible.
  const last = periodFrom(addMonths(current.start, term), term);
  while (p.start <= last.start) {
    const billing = service.billings.find((b) => covers(b, p));
    const isNext = p.start > current.start;
    const state: PeriodState = billing
      ? billing.matchedBy === "MISSED"
        ? "MISSED"
        : billing.matchedBy === "EXTERNAL"
          ? "EXTERNAL"
          : "BILLED"
      : isNext
        ? // A term beyond a cancelled service's current one will never run, so
          // it's neither due nor merely future — it's off.
          isCancelled(service)
          ? "CANCELLED"
          : upcoming?.advance && upcoming.period.start.getTime() === p.start.getTime()
            ? "DUE"
            : "FUTURE"
        : service.billings.length
          ? "GAP"
          : "UNKNOWN";

    out.push({
      start: p.start,
      end: p.end,
      year: p.start.getFullYear(),
      state,
      amount: billing?.amount ?? null,
      xeroInvoiceId: billing?.xeroInvoiceId ?? null,
      xeroNumber: billing?.xeroNumber ?? null,
      xeroStatus: billing?.xeroStatus ?? null,
    });
    p = periodFrom(addMonths(p.start, term), term);
  }
  return out;
}

/**
 * Lay several services out on shared year columns.
 *
 * Columns are the calendar year a term *starts* in, so services renewing in
 * different months still line up: a domain renewing in March and hosting
 * renewing in October both sit under the same year, which is how someone
 * thinks about "have I billed this site for 2025?".
 */
export function buildPeriodGrid(services: Svc[], now: Date = new Date()): PeriodGrid {
  const rows: PeriodRow[] = [];

  for (const s of services) {
    const periods = servicePeriods(s, now);
    if (!periods.length) continue;
    rows.push({
      serviceId: s.id,
      kind: s.kind,
      label: s.label,
      quantity: s.quantity,
      managedBy: s.managedBy,
      termMonths: s.termMonths || 12,
      cancelled: isCancelled(s),
      periods,
      gaps: periods.filter((p) => p.state === "GAP").length,
      unknown: periods.filter((p) => p.state === "UNKNOWN").length,
    });
  }

  // Include each annual column occupied by a multi-year term. The period is
  // still actionable only in its start year; the other columns show coverage.
  const years = [
    ...new Set(
      rows.flatMap((r) =>
        r.periods.flatMap((p) =>
          Array.from(
            { length: Math.max(1, Math.ceil(r.termMonths / 12)) },
            (_, offset) => p.year + offset
          )
        )
      )
    ),
  ].sort();
  rows.sort(
    (a, b) =>
      b.gaps - a.gaps ||
      b.unknown - a.unknown ||
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label)
  );

  return {
    years,
    rows,
    totalGaps: rows.reduce((n, r) => n + r.gaps, 0),
    totalUnknown: rows.reduce((n, r) => n + r.unknown, 0),
  };
}
