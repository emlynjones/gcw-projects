/**
 * The recurring book, arranged as work to do.
 *
 * Three questions, in the order they matter:
 *
 *  1. What has already renewed with no invoice against it? That's money out the
 *     door — the supplier has been paid and the client hasn't.
 *  2. What renews soon enough to bill ahead of it?
 *  3. When does the rest fall due, so a heavy month isn't a surprise?
 *
 * Grouped by website rather than by service, because the website page is where
 * both fixes live: link an invoice that already exists to the period, or raise
 * a new one. A list of loose services would send you hunting for the site.
 *
 * Pure — the caller supplies the rows — so the shape can be tested against
 * fixtures without a database.
 */

import { servicePeriods, type PeriodState } from "@/lib/billing-periods";
import {
  annualCost,
  isBillable,
  nextRenewal,
  isMonthlyKind,
  trustedUnitPrice,
  isCancelled,
} from "@/lib/recurring";
import { IMPLAUSIBLE_MARGIN } from "@/lib/billing-raise";

export type DashboardService = {
  id: string;
  kind: string;
  label: string;
  quantity: number;
  costPrice: number;
  costBasis: string;
  sellPrice: number;
  renewalDate: Date | null;
  termMonths: number;
  xeroItemCode: string | null;
  managedBy: string;
  cancelledAt?: Date | null;
  _count: { invoiceLines: number };
  billings: {
    periodStart: Date;
    periodEnd: Date;
    amount: number;
    xeroInvoiceId: string | null;
    xeroNumber: string | null;
    xeroStatus: string | null;
    matchedBy: string;
  }[];
};

export type DashboardWebsite = {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  clientInternal: boolean;
  services: DashboardService[];
};

export type PeriodItem = {
  serviceId: string;
  kind: string;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  state: Extract<PeriodState, "GAP" | "UNKNOWN" | "DUE"> | "REVIEW";
  /** What it would be billed at, or null when no price can be trusted. */
  value: number | null;
  /** Days since the period began (overdue) or until it starts (upcoming). */
  days: number;
};

export type SiteGroup = {
  websiteId: string;
  websiteName: string;
  clientId: string | null;
  clientName: string | null;
  items: PeriodItem[];
  value: number;
  /** Any item here with no usable price — the site can be reviewed but not billed. */
  unpriced: number;
  /** Oldest overdue period, for sorting; days since it started. */
  worstDays: number;
};

export type RenewalMonth = {
  /** First of the month, for labelling. */
  month: Date;
  count: number;
  value: number;
  byKind: Record<string, number>;
  items: {
    serviceId: string;
    label: string;
    kind: string;
    renewal: Date;
    websiteId: string;
    websiteName: string;
    clientName: string | null;
    value: number | null;
  }[];
};

export type RecurringDashboard = {
  review: SiteGroup[];
  overdue: SiteGroup[];
  upcoming: SiteGroup[];
  months: RenewalMonth[];
  overdueValue: number;
  upcomingValue: number;
  overdueCount: number;
  reviewCount: number;
  upcomingCount: number;
  /** Overdue periods carrying no usable price, so they can't simply be raised. */
  overdueUnpriced: number;
  /** Periods whose price is too far above cost to believe — excluded from totals. */
  suspectPrices: number;
};

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** How far ahead the renewal calendar looks. */
export const CALENDAR_MONTHS = 12;

export function buildRecurringDashboard(
  websites: DashboardWebsite[],
  itemPrices: Map<string, number | null>,
  now: Date = new Date()
): RecurringDashboard {
  const overdue: SiteGroup[] = [];
  const review: SiteGroup[] = [];
  const upcoming: SiteGroup[] = [];
  const months = new Map<string, RenewalMonth>();
  let suspect = 0;

  // Seed every month in the window, so a quiet month reads as genuinely quiet
  // rather than missing from the chart.
  for (let i = 0; i < CALENDAR_MONTHS; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.set(m.toISOString(), { month: m, count: 0, value: 0, byKind: {}, items: [] });
  }

  for (const site of websites) {
    if (site.clientInternal) continue;
    const late: PeriodItem[] = [];
    const needsReview: PeriodItem[] = [];
    const soon: PeriodItem[] = [];

    for (const svc of site.services) {
      if (!isBillable(svc)) continue;

      const cost = annualCost(svc);
      const priced = trustedUnitPrice(svc, itemPrices, cost);
      let value = priced ? round2(priced.price * (svc.quantity || 1)) : null;

      // A price far above cost is bad data, not revenue. Counting
      // placemaking-ceredigion.wales — a £14.84 domain carrying £6,966.42 from
      // a mis-imported build fee — would put £15k into one month of the
      // calendar and make the whole shape of the year a lie.
      if (value !== null && cost > 0 && value > cost * IMPLAUSIBLE_MARGIN) {
        value = null;
        suspect++;
      }

      // Care plans renew monthly and bill from a Xero repeating invoice; they
      // don't belong in a list of renewals to chase or a year-scale calendar.
      if (!isMonthlyKind(svc.kind)) {
        for (const p of servicePeriods(svc, now)) {
          if (p.state === "GAP" || p.state === "UNKNOWN") {
            const target = svc._count.invoiceLines > 0 ? late : needsReview;
            target.push({
              serviceId: svc.id,
              kind: svc.kind,
              label: svc.label,
              periodStart: p.start,
              periodEnd: p.end,
              state: svc._count.invoiceLines > 0 ? p.state : "REVIEW",
              value,
              days: Math.floor((now.getTime() - p.start.getTime()) / DAY),
            });
          } else if (p.state === "DUE") {
            soon.push({
              serviceId: svc.id,
              kind: svc.kind,
              label: svc.label,
              periodStart: p.start,
              periodEnd: p.end,
              state: "DUE",
              value,
              days: Math.ceil((p.start.getTime() - now.getTime()) / DAY),
            });
          }
        }

        // The calendar plots the next renewal, whether or not it's billable yet
        // — the question it answers is "what's coming", not "what can I raise".
        // A cancelled service has no next renewal to plot: showing one would
        // overstate the year ahead by money that will never be charged.
        const next = isCancelled(svc) ? null : nextRenewal(svc, now);
        if (next) {
          const key = new Date(next.getFullYear(), next.getMonth(), 1).toISOString();
          const bucket = months.get(key);
          if (bucket) {
            bucket.count++;
            bucket.value = round2(bucket.value + (value ?? 0));
            bucket.byKind[svc.kind] = (bucket.byKind[svc.kind] ?? 0) + 1;
            bucket.items.push({
              serviceId: svc.id,
              label: svc.label,
              kind: svc.kind,
              renewal: next,
              websiteId: site.id,
              websiteName: site.name,
              clientName: site.clientName,
              value,
            });
          }
        }
      }
    }

    const group = (items: PeriodItem[]): SiteGroup => ({
      websiteId: site.id,
      websiteName: site.name,
      clientId: site.clientId,
      clientName: site.clientName,
      items: items.sort((a, b) => b.days - a.days),
      value: round2(items.reduce((n, i) => n + (i.value ?? 0), 0)),
      unpriced: items.filter((i) => i.value === null).length,
      worstDays: items.reduce((n, i) => Math.max(n, i.days), 0),
    });

    if (late.length) overdue.push(group(late));
    if (needsReview.length) review.push(group(needsReview));
    if (soon.length) upcoming.push(group(soon));
  }

  // Biggest money first. Sorting by age instead put a £56 gap from 2022 above a
  // £510 one from this year — the older miss is less collectable, not more
  // urgent. Age is still shown on every row, and breaks ties.
  overdue.sort((a, b) => b.value - a.value || b.worstDays - a.worstDays);
  review.sort((a, b) => b.value - a.value || b.worstDays - a.worstDays);
  upcoming.sort(
    (a, b) =>
      Math.min(...a.items.map((i) => i.days)) - Math.min(...b.items.map((i) => i.days)) ||
      b.value - a.value
  );

  const flat = (gs: SiteGroup[]) => gs.flatMap((g) => g.items);

  return {
    review,
    overdue,
    upcoming,
    months: [...months.values()]
      .map((month) => ({
        ...month,
        items: month.items.sort((a, b) => a.renewal.getTime() - b.renewal.getTime()),
      }))
      .sort((a, b) => a.month.getTime() - b.month.getTime()),
    overdueValue: round2(overdue.reduce((n, g) => n + g.value, 0)),
    upcomingValue: round2(upcoming.reduce((n, g) => n + g.value, 0)),
    overdueCount: flat(overdue).length,
    reviewCount: flat(review).length,
    upcomingCount: flat(upcoming).length,
    overdueUnpriced: flat(overdue).filter((i) => i.value === null).length,
    suspectPrices: suspect,
  };
}
