/**
 * Recurring services model.
 *
 * Domains, hosting and Office 365 licences all renew on a fixed term (annual by
 * default) and are billed on to the client. They share one table discriminated
 * by `kind`, so one import / report / invoicing flow serves all of them.
 *
 * A service's *current period* is derived from `renewalDate` + `termMonths`,
 * never stored — the renewal date is the one thing suppliers actually tell us,
 * so everything else is computed from it and the two can't disagree.
 */

/* ---------- Kinds ---------- */

export const SERVICE_KINDS = ["DOMAIN", "HOSTING", "O365", "CAREPLAN", "OTHER"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  DOMAIN: "Domain",
  HOSTING: "Hosting",
  O365: "Office 365",
  CAREPLAN: "Care plan",
  OTHER: "Other",
};

/**
 * Care plans are the odd one out and it's worth being explicit about why.
 *
 * The other kinds are bought in on an annual renewal and resold, so the money
 * question is margin: what it costs against what it's charged. A care plan is
 * our own time, billed monthly, usually at zero bought-in cost — so margin is
 * meaningless and the only question that matters is whether *this month* went
 * out. Different question, different term, so it's reported separately.
 */
export const isMonthlyKind = (kind: string) => kind === "CAREPLAN";

/* ---------- Who manages it ---------- */

export const MANAGED_BY = ["GCW", "INTERNAL", "CLIENT", "THIRD_PARTY"] as const;
export type ManagedBy = (typeof MANAGED_BY)[number];

export const MANAGED_BY_LABELS: Record<ManagedBy, string> = {
  GCW: "We buy and bill it",
  INTERNAL: "Ours — do not invoice",
  CLIENT: "Client manages it",
  THIRD_PARTY: "Another agency",
};

export function managedByLabel(v: string): string {
  return MANAGED_BY_LABELS[v as ManagedBy] ?? v;
}

export function isManagedBy(v: string): v is ManagedBy {
  return (MANAGED_BY as readonly string[]).includes(v);
}

/**
 * Is this ours to invoice?
 *
 * A client's own domain, or one held by another agency, still belongs on the
 * website — knowing it exists is the point of an oversight layer. It just
 * mustn't appear in a billing run or count as unbilled revenue, because nobody
 * here is paying for it or charging for it.
 */
export const isBillable = (s: {
  managedBy?: string | null;
  client?: { isInternal?: boolean } | null;
  clientInternal?: boolean;
}) =>
  !s.client?.isInternal && !s.clientInternal && (s.managedBy ?? "GCW") === "GCW";

/* ---------- Cancellation ---------- */

/**
 * Has this been told not to renew?
 *
 * Deliberately not the same as `active: false`, which takes a row out of every
 * view at once. A cancelled service is still running to the end of the term
 * already paid for: that term stays billable if it was never invoiced, and the
 * service stays visible on its website. What stops is everything forward-looking
 * — no advance billing, nothing in the renewal calendar.
 *
 * Money already owed doesn't stop being owed because the client gave notice.
 */
export const isCancelled = (s: { cancelledAt?: Date | null }) => !!s.cancelledAt;

export function serviceKindLabel(k: string): string {
  return SERVICE_KIND_LABELS[k as ServiceKind] ?? k;
}

export function isServiceKind(k: string): k is ServiceKind {
  return (SERVICE_KINDS as readonly string[]).includes(k);
}

/* ---------- Money ---------- */

/**
 * What a service costs and earns over a year.
 *
 * Two things made this worth centralising. Suppliers bill the same product
 * either monthly or annually — Cloud.Market invoices some O365 subscriptions at
 * £4.11/month and others at £46.92/year — so a bare `costPrice` is meaningless
 * without knowing which. And cost is quoted *per seat*, so a two-seat licence
 * costs twice what the column says.
 *
 * Totals used to sum `costPrice` flat while multiplying `sellPrice` by quantity,
 * which quietly overstated the margin on every multi-seat licence. Everything
 * now goes through these two functions so the two halves can't drift apart.
 */
export const COST_BASES = ["ANNUAL", "MONTHLY"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  ANNUAL: "per year",
  MONTHLY: "per month",
};

export function isCostBasis(v: string): v is CostBasis {
  return (COST_BASES as readonly string[]).includes(v);
}

type Priced = {
  costPrice: number;
  costBasis: string;
  sellPrice: number;
  quantity: number;
  /** Optional so existing callers are unaffected — absent means annual. */
  termMonths?: number;
};

/** Money is pence — rounding here stops float dust accumulating across a total. */
const pence = (n: number) => Math.round(n * 100) / 100;

/**
 * How many times a year this is charged.
 *
 * `sellPrice` is per billing period, and until care plans arrived every service
 * had a twelve-month term, so per-period and per-year were the same number.
 * A monthly care plan bills twelve times, so the two part company. Every
 * existing row is termMonths 12, which lands on 1 here — the arithmetic below
 * is unchanged for everything that came before.
 */
export const periodsPerYear = (termMonths?: number) =>
  termMonths && termMonths > 0 ? 12 / termMonths : 1;

/** Annual ex-VAT cost to us, across all seats. */
export function annualCost(s: Priced): number {
  // costBasis says how costPrice is quoted (per month or per year); termMonths
  // says how long a billing period runs. A monthly-quoted cost is already
  // annualised by the ×12, so the term must not be applied on top of it.
  const perUnitYear =
    s.costBasis === "MONTHLY" ? s.costPrice * 12 : s.costPrice * periodsPerYear(s.termMonths);
  return pence(perUnitYear * (s.quantity || 1));
}

/** Annual ex-VAT charge to the client, across all seats. */
export function annualSell(s: Priced): number {
  return pence(s.sellPrice * (s.quantity || 1) * periodsPerYear(s.termMonths));
}

/**
 * What this actually charges per period, per unit.
 *
 * Two sources, in order: the service's own `sellPrice` when set, otherwise the
 * price on the Xero product it's mapped to.
 *
 * The order matters. Prices belong in Xero — that's the accounting system and
 * where they get maintained — so the product's price is the default and a
 * `sellPrice` here is an *override* for the client on a non-standard rate.
 * Reading it rather than copying it means correcting a rate in Xero and
 * re-syncing (one API call) fixes it everywhere, with no second copy to drift.
 *
 * Returns null when neither has a price. That's a flag, not a zero: a service
 * with no price can't be invoiced, and quietly billing £0 would be worse than
 * refusing to bill at all.
 */
export function effectiveSellPrice(
  service: { sellPrice: number; xeroItemCode?: string | null },
  itemPrices?: Map<string, number | null>
): { price: number; source: "service" | "product" } | null {
  if (service.sellPrice > 0) return { price: service.sellPrice, source: "service" };
  const fromItem = service.xeroItemCode ? itemPrices?.get(service.xeroItemCode) : null;
  if (fromItem && fromItem > 0) return { price: fromItem, source: "product" };
  return null;
}

/**
 * The unit price we're willing to act on, or null.
 *
 * A price taken from a Xero product is only trusted when it clears cost. Xero
 * items carry no billing period, so `O365-BE` at £6 could be £6 a month or £6 a
 * year — and for that item it's a month, while the service bills annually.
 * Taken at face value it would invoice £18 for three seats costing £147.96.
 * There's no field to disambiguate it, so the test is whether the answer is
 * even possible: a fallback price below cost is a unit mismatch, not a bargain.
 *
 * A price set on the service itself is never second-guessed this way — selling
 * below cost is a decision someone can legitimately have made, and it's
 * reported separately.
 */
export function trustedUnitPrice(
  service: { sellPrice: number; xeroItemCode?: string | null; quantity: number },
  itemPrices: Map<string, number | null>,
  annualCostOfService: number
): { price: number; source: "service" | "product" } | null {
  const priced = effectiveSellPrice(service, itemPrices);
  if (priced?.source === "product" && annualCostOfService > 0) {
    const wouldCharge = Math.round(priced.price * (service.quantity || 1) * 100) / 100;
    if (wouldCharge < annualCostOfService) return null;
  }
  return priced;
}

export function annualMargin(s: Priced): number {
  return annualSell(s) - annualCost(s);
}

/**
 * Sum a list — the shape every total on the site needs. Rounded again after
 * summing: adding exact pence still lands on 218.67000000000002 in binary
 * floating point, and a margin figure has no business showing that.
 */
export function totals(services: Priced[]): { cost: number; sell: number; margin: number } {
  const cost = pence(services.reduce((n, s) => n + annualCost(s), 0));
  const sell = pence(services.reduce((n, s) => n + annualSell(s), 0));
  return { cost, sell, margin: pence(sell - cost) };
}

/* ---------- Billing periods ---------- */

export type Period = { start: Date; end: Date };

/** Add whole months, clamping to the last day of the target month (31 Jan + 1mo = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const targetMonth = out.getMonth() + months;
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(targetMonth);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return out;
}

/**
 * The period the renewal date starts. A renewal on 12 Aug 2026 with a 12-month
 * term covers 12 Aug 2026 → 11 Aug 2027 (end is the last day *inside* the term).
 */
export function periodFrom(renewalDate: Date, termMonths: number): Period {
  const start = new Date(renewalDate.getTime());
  const end = addMonths(start, termMonths || 12);
  end.setDate(end.getDate() - 1);
  return { start, end };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The next renewal falling due on or after today.
 *
 * The stored date comes from the supplier (a registrar "expiry date", a
 * subscription "next billing date") and is authoritative, so we only ever roll
 * it *forward* — never back. Rolling back would treat a domain paid up two
 * years ahead as due next year and invoice the client for cover they already
 * have. Forward stepping only handles the opposite case: an export that has
 * gone stale since it was taken.
 *
 * Do not "fix" this to search both directions. `periodForDate` below does walk
 * backwards, and deliberately so — but it's answering a different question
 * (which past period did this invoice pay for?), where going back is the whole
 * point. Deciding what to bill *next* must never look backwards.
 */
export function nextRenewal(
  service: { renewalDate: Date | null; termMonths: number },
  now: Date = new Date()
): Date | null {
  if (!service.renewalDate) return null;
  const term = service.termMonths || 12;
  const today = startOfDay(now);

  let next = new Date(service.renewalDate.getTime());
  // Bounded so a nonsense term can't spin forever.
  for (let i = 0; i < 200 && startOfDay(next) < today; i++) {
    next = addMonths(next, term);
  }
  return next;
}

/**
 * The term running up to the next renewal — i.e. the cover the client should
 * already have been invoiced for. This is what the billed/unbilled check looks
 * at: if nothing covers it, that renewal was paid to the supplier and never
 * passed on.
 */
export function currentPeriod(
  service: { renewalDate: Date | null; termMonths: number },
  now: Date = new Date()
): Period | null {
  const next = nextRenewal(service, now);
  if (!next) return null;
  const term = service.termMonths || 12;
  return periodFrom(addMonths(next, -term), term);
}

/** The term that begins at the next renewal — what you'd invoice when billing ahead. */
export function upcomingPeriod(
  service: { renewalDate: Date | null; termMonths: number },
  now: Date = new Date()
): Period | null {
  const next = nextRenewal(service, now);
  if (!next) return null;
  return periodFrom(next, service.termMonths || 12);
}

/**
 * The period a payment dated `date` most likely covers.
 *
 * Used to align a historical Xero invoice to the renewal it paid for. Invoices
 * rarely land on the renewal date itself — one raised in February for a March
 * renewal is paying for the March term — so we snap to the *nearest* anniversary
 * rather than the containing one.
 *
 * Anniversaries are a term apart, so some anniversary is always within half a
 * term of any date — this never fails to find one, and isn't meant to. How far
 * the invoice sits from the renewal is a separate question, and the caller is
 * expected to weigh it (a bill raised a fortnight before a renewal is obviously
 * that renewal; one raised five months before might be a batch invoice, or might
 * be nothing to do with it).
 *
 * Unlike `nextRenewal` this walks backwards as well as forwards: the whole job
 * is to find a past period. Because the result is always a true anniversary of
 * the stored renewal date, it's deterministic — which is what lets
 * ServiceBilling's unique (service, periodStart) key make re-scanning idempotent.
 *
 * Services with no renewal date have no anniversary sequence to snap to, so the
 * caller decides what to do (we fall back to the invoice date itself).
 */
export function periodForDate(
  service: { renewalDate: Date | null; termMonths: number },
  date: Date
): Period | null {
  if (!service.renewalDate) return null;
  const term = service.termMonths || 12;

  // Jump straight to the right neighbourhood, then check the anniversaries
  // either side — month lengths make the arithmetic estimate approximate.
  const msPerMonth = 30.44 * 86_400_000;
  const approx = Math.round((date.getTime() - service.renewalDate.getTime()) / (msPerMonth * term));

  let best: Date | null = null;
  let bestGap = Infinity;
  for (let step = approx - 1; step <= approx + 1; step++) {
    const candidate = addMonths(service.renewalDate, step * term);
    const gap = Math.abs(candidate.getTime() - date.getTime());
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  if (!best) return null;
  return periodFrom(best, term);
}

/** How far a date sits from the start of a period, in whole days. */
export function gapDays(period: Period, date: Date): number {
  return Math.round(Math.abs(period.start.getTime() - date.getTime()) / 86_400_000);
}

/* ---------- Billing state ---------- */

/**
 * Only three states. `currentPeriod` always resolves to the period *containing*
 * today, so "not started yet" is unreachable — an unbilled current period is
 * always already running, which is exactly the money-leak this feature exists
 * to surface. Use `renewsWithin` separately to bill ahead of a renewal.
 */
export const BILLING_STATES = ["BILLED", "UNBILLED", "REVIEW", "NOT_BILLABLE", "NO_DATE"] as const;
export type BillingState = (typeof BILLING_STATES)[number];

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  BILLED: "Billed",
  UNBILLED: "Not billed",
  REVIEW: "Review invoice links",
  NOT_BILLABLE: "Not invoiced",
  NO_DATE: "No renewal date",
};

export function billingStateLabel(s: string): string {
  return BILLING_STATE_LABELS[s as BillingState] ?? s;
}

/**
 * Whether the service's current period has been billed.
 * A billing counts if its period overlaps the current one — suppliers and
 * invoices rarely align to the day, so exact-date matching would miss most.
 */
/**
 * How far ahead a renewal can be invoiced.
 *
 * Renewals are billed in advance: the supplier is paid at renewal, so the
 * invoice needs to be out — and ideally paid — before that date rather than
 * after it. Sixty days is roughly two chase cycles, enough for a late payer
 * without sending invoices so early the client queries what they're for.
 */
export const ADVANCE_BILLING_DAYS = 60;

/**
 * How far a renewal date may sit from the billing anniversary before it's worth
 * questioning. Three days absorbs month-end rounding and invoices raised a day
 * either side; beyond that the two records genuinely disagree.
 */
export const RENEWAL_DRIFT_TOLERANCE_DAYS = 3;

/**
 * Days between the stored renewal date and the date this has actually been
 * billed from, ignoring the year.
 *
 * The period model assumes one date serves both purposes: when we pay the
 * supplier and when we bill the client. For 230 of 231 services with history
 * that holds. Where it doesn't, the consequence is quiet and expensive — a
 * hosting service billed every 1st September but recorded as renewing 30th July
 * reads as covered, because the year already invoiced overlaps the year the app
 * thinks is current. Nothing is offered, and a renewal goes unbilled.
 *
 * Returns null when there's no history to compare against.
 */
export function renewalDrift(
  service: { renewalDate: Date | null },
  billings: { periodStart: Date }[]
): { days: number; billedFrom: Date } | null {
  if (!service.renewalDate || !billings.length) return null;
  const latest = billings.reduce((a, b) => (b.periodStart > a.periodStart ? b : a));
  const dayOfYear = (d: Date) => d.getMonth() * 31 + d.getDate();
  const raw = Math.abs(dayOfYear(service.renewalDate) - dayOfYear(latest.periodStart));
  return { days: Math.min(raw, 372 - raw), billedFrom: latest.periodStart };
}

const DAY_MS = 86_400_000;

export type BillablePeriod = {
  period: Period;
  /** True when this is next year's renewal, billed before it falls due. */
  advance: boolean;
  /** Days until the period starts; negative once it has begun. */
  daysUntilStart: number;
};

/**
 * The period this service should be invoiced for next, if any.
 *
 * Two cases, in order of priority:
 *
 *  1. **The current period isn't billed.** Invoice that — it's already running
 *     and being paid for, so it's overdue rather than early.
 *  2. **The current period is billed and the next renewal is close.** Invoice
 *     the next period, from `ADVANCE_BILLING_DAYS` before it starts.
 *
 * Returns null when the current period is covered and the next renewal is still
 * far off, which is the normal state for most services most of the time.
 */
export function nextBillablePeriod(
  service: { renewalDate: Date | null; termMonths: number; cancelledAt?: Date | null },
  billings: { periodStart: Date; periodEnd: Date }[],
  now: Date = new Date(),
  leadDays: number = ADVANCE_BILLING_DAYS
): BillablePeriod | null {
  const current = currentPeriod(service, now);
  if (!current) return null;

  // Advance billing is for annual renewals only. Domains and hosting are bought
  // in on a fixed date and want invoicing before it, so the client has paid
  // before we do. A monthly care plan has nothing to bill ahead — the month
  // either has run or hasn't, and billing sixty days out would put September
  // and October on an August invoice.
  //
  // A cancelled service never bills ahead either: there is no next term to
  // charge for. Its current term above is still offered when unbilled, because
  // giving notice doesn't cancel the year already running.
  const billsAhead = (service.termMonths || 12) >= 12 && !isCancelled(service);

  const covers = (p: Period) =>
    billings.some((b) => b.periodStart <= p.end && b.periodEnd >= p.start);

  const daysUntil = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / DAY_MS);

  if (!covers(current)) {
    return { period: current, advance: false, daysUntilStart: daysUntil(current.start) };
  }

  if (!billsAhead) return null;

  const term = service.termMonths || 12;
  const next = periodFrom(addMonths(current.start, term), term);
  if (covers(next)) return null;

  const until = daysUntil(next.start);
  return until <= leadDays ? { period: next, advance: true, daysUntilStart: until } : null;
}

export function billingStateOf(
  service: {
    renewalDate: Date | null;
    termMonths: number;
    managedBy?: string | null;
    client?: { isInternal?: boolean } | null;
    clientInternal?: boolean;
  },
  billings: { periodStart: Date; periodEnd: Date }[],
  now: Date = new Date(),
  linkedInvoiceItems?: number
): BillingState {
  if (!isBillable(service)) return "NOT_BILLABLE";
  const period = currentPeriod(service, now);
  if (!period) return "NO_DATE";
  const covered = billings.some((b) => b.periodStart <= period.end && b.periodEnd >= period.start);
  if (covered) return "BILLED";
  // A service with no linked Xero lines has not yet been reconciled, so calling
  // it "not billed" would be an assertion we cannot support. Once at least one
  // line is linked, a missing current-period invoice is a genuine billing gap.
  return linkedInvoiceItems === 0 ? "REVIEW" : "UNBILLED";
}

/** Days until the next renewal — negative never happens (see currentPeriod). */
export function daysUntilRenewal(
  service: { renewalDate: Date | null; termMonths: number },
  now: Date = new Date()
): number | null {
  const next = nextRenewal(service, now);
  if (!next) return null;
  return Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
}

/** True when the next renewal falls within `days` — the "bill it ahead" window. */
export function renewsWithin(
  service: { renewalDate: Date | null; termMonths: number },
  days: number,
  now: Date = new Date()
): boolean {
  const d = daysUntilRenewal(service, now);
  return d !== null && d <= days;
}

/** Formats a period for invoice line text / report display. */
export function periodLabel(p: Period): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
  return `${fmt(p.start)} – ${fmt(p.end)}`;
}
