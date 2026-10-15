/**
 * Finding the care plans hiding in invoice history.
 *
 * Care plans are a monthly revenue stream — ~£38.5k a year across 44 clients —
 * that has never been modelled as a `RecurringService`, so none of it shows up
 * in the billing register. The invoices are the only record of it, and this
 * turns them into service proposals.
 *
 * The wording is not co-operative. Three things the real ledger does that a
 * naive reading gets wrong:
 *
 *  1. **The line amount is not a monthly price.** "Essentials care plan for 1
 *     calendar month — £240" and "Our Dyslexic Connection Care Plan for 12
 *     months — £240" are both £240 lines meaning £240/month and £20/month.
 *  2. **One client can be a reseller.** Catch Design Management carries nine
 *     distinct care plans for their own clients, mostly named in prose with no
 *     domain to key on.
 *  3. **Some matching lines aren't care plans at all** — "Set up of new email
 *     (1 hour with care plan discount)" is hourly work that happens to say the
 *     words.
 *
 * So nothing is proposed from a single line. A candidate has to show a repeated
 * charge at a consistent monthly price; anything short of that is returned as
 * CHECK with its evidence, for a human to decide. Guessing here would put wrong
 * prices into the billing register, which is worse than proposing nothing.
 */

import { extractDomains } from "@/lib/domains";

export type DiscoveryLine = {
  id: string;
  clientId: string | null;
  description: string;
  reference: string | null;
  quantity: number;
  lineAmount: number;
  invoiceDate: Date;
  xeroNumber: string | null;
  domains: string[];
};

export type CarePlanCandidate = {
  key: string;
  clientId: string;
  /** Proposed service label. */
  label: string;
  /** Domain the plan names, when it names one — used to attach a website. */
  domain: string | null;
  monthlyPrice: number;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  /** Months since the last charge — a live plan should be 0 or 1. */
  monthsSinceLast: number;
  /** CLEAR: repeated at a consistent price. CHECK: inconsistent, needs a look. */
  confidence: "CLEAR" | "CHECK";
  reason: string;
  lineIds: string[];
  samples: string[];
};

/** Wording that identifies a care-plan charge, in both languages. */
const CARE_PLAN =
  /(care plan|care package|maintenance package|support and maintenance|pecyn gofal|gofal gwe|gofal safonol|cynllun gofal)/i;

/**
 * Wording that means the line is *priced* as something else and merely mentions
 * a plan — a discounted hour, a setup fee. Without this the register gains a
 * "£35/month care plan" that never existed.
 */
const NOT_A_PLAN_CHARGE = /\b(discount|set ?up of|hour with|one[- ]off)\b/i;

const MONTH_NAMES =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|ionawr|chwefror|mawrth|ebrill|mai|mehefin|gorffennaf|awst|medi|hydref|tachwedd|rhagfyr)\b/gi;

/**
 * How many months of cover this line paid for.
 *
 * Read in order of how explicit the wording is: an explicit month count beats a
 * multiplier, which beats counting named months. "for 1 calendar month" is the
 * common case and lands on 1 either way.
 */
export function monthsCovered(text: string, quantity: number): number {
  const explicit = /(\d{1,2})\s*(?:calendar\s*)?months?\b/i.exec(text);
  if (explicit) {
    const n = parseInt(explicit[1], 10);
    if (n >= 1 && n <= 36) return n;
  }

  const times = /\bx\s*(\d{1,2})\b|\b(\d{1,2})\s*x\b/i.exec(text);
  if (times) {
    const n = parseInt(times[1] ?? times[2], 10);
    if (n >= 2 && n <= 36) return n;
  }

  // "October, November, December" — only trust it as a span when several are
  // named, since a single month name is just saying which month this is for.
  const named = text.match(MONTH_NAMES);
  if (named) {
    const distinct = new Set(named.map((m) => m.toLowerCase()));
    if (distinct.size >= 2) return distinct.size;
  }

  // A quantity of 12 on a plan line is a year of it, not twelve subscriptions.
  if (quantity >= 2 && quantity <= 36 && Number.isInteger(quantity)) return quantity;

  return 1;
}

const pence = (n: number) => Math.round(n * 100) / 100;

/** Strip the volatile parts so repeated months of one plan read as one thing. */
function subjectOf(text: string): string {
  return text
    .toLowerCase()
    .replace(MONTH_NAMES, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\d+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Title-case a domain-less plan into something readable in the register. */
function labelFor(domain: string | null, samples: string[], monthly: number): string {
  if (domain) return domain;
  const plan = /\b(essentials|booster|growth|elevator|basic|standard|premium|safonol|hanfodion|twf)\b/i.exec(
    samples[0] ?? ""
  );
  const name = plan ? `${plan[1][0].toUpperCase()}${plan[1].slice(1).toLowerCase()} care plan` : "Care plan";
  return `${name} — £${monthly.toFixed(2)}/mo`;
}

const MONTH_MS = 30.44 * 86_400_000;

/**
 * Group care-plan lines into proposable services.
 *
 * Grouped by client and then by domain where one is named, falling back to the
 * monthly price. Price is a crude key, but it's the one thing that reliably
 * separates a reseller's nine plans when the prose won't — and two plans at the
 * same price for the same client are, for billing purposes, the same commitment
 * repeated, which the quantity can carry.
 */
export function discoverCarePlans(lines: DiscoveryLine[], now = new Date()): CarePlanCandidate[] {
  const groups = new Map<string, { clientId: string; domain: string | null; lines: DiscoveryLine[]; monthly: number[] }>();

  for (const line of lines) {
    if (!line.clientId) continue;
    const text = `${line.description} ${line.reference ?? ""}`;
    if (!CARE_PLAN.test(text)) continue;
    if (NOT_A_PLAN_CHARGE.test(text)) continue;
    if (line.lineAmount <= 0) continue;

    const months = monthsCovered(text, line.quantity);
    const monthly = pence(line.lineAmount / months);
    const domain = (line.domains[0] ?? extractDomains(text)[0] ?? null) as string | null;

    // Round to the nearest pound for the key so £74.99 and £75 group together.
    const key = `${line.clientId}::${domain ?? `£${Math.round(monthly)}`}`;
    const g = groups.get(key);
    if (g) {
      g.lines.push(line);
      g.monthly.push(monthly);
    } else {
      groups.set(key, { clientId: line.clientId, domain, lines: [line], monthly: [monthly] });
    }
  }

  const out: CarePlanCandidate[] = [];

  for (const [key, g] of groups) {
    const sorted = [...g.lines].sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime());
    const firstSeen = sorted[0].invoiceDate;
    const lastSeen = sorted[sorted.length - 1].invoiceDate;

    // The modal monthly price, not the mean — one mis-parsed line shouldn't drag
    // the price of a plan that has been £75 every month for three years.
    const tally = new Map<number, number>();
    for (const m of g.monthly) tally.set(m, (tally.get(m) ?? 0) + 1);
    const [monthlyPrice, agreeing] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const consistency = agreeing / g.monthly.length;

    const monthsSinceLast = Math.floor((now.getTime() - lastSeen.getTime()) / MONTH_MS);

    let confidence: "CLEAR" | "CHECK" = "CLEAR";
    let reason = `£${monthlyPrice.toFixed(2)}/month on ${agreeing} of ${g.lines.length} charges`;

    if (g.lines.length < 3) {
      confidence = "CHECK";
      reason = `only ${g.lines.length} charge${g.lines.length === 1 ? "" : "s"} — too few to be sure of the price`;
    } else if (consistency < 0.6) {
      confidence = "CHECK";
      reason = `price varies — £${monthlyPrice.toFixed(2)} on only ${agreeing} of ${g.lines.length} charges`;
    } else if (monthsSinceLast > 3) {
      confidence = "CHECK";
      reason = `${reason}, but nothing charged for ${monthsSinceLast} months — may have ended`;
    }

    const samples = sorted.slice(-3).reverse().map((l) => l.description);

    out.push({
      key,
      clientId: g.clientId,
      label: labelFor(g.domain, samples, monthlyPrice),
      domain: g.domain,
      monthlyPrice,
      occurrences: g.lines.length,
      firstSeen,
      lastSeen,
      monthsSinceLast,
      confidence,
      reason,
      lineIds: sorted.map((l) => l.id),
      samples,
    });
  }

  // Live and certain first, then by what they're worth a year.
  return out.sort(
    (a, b) =>
      Number(a.confidence === "CHECK") - Number(b.confidence === "CHECK") ||
      b.monthlyPrice * b.occurrences - a.monthlyPrice * a.occurrences
  );
}

/** Annualised value of a set of candidates — what the register is missing. */
export function candidateAnnualValue(cs: CarePlanCandidate[]): number {
  return pence(cs.reduce((n, c) => n + c.monthlyPrice * 12, 0));
}
