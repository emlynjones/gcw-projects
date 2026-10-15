/**
 * Matching cached Xero invoice lines to the recurring services they paid for.
 *
 * This is what turns "we hold 177 domains" into "here's what has actually been
 * billed, and for which period". The evidence is the invoice line's free text,
 * which is written by a human and therefore inconsistent — so we only ever act
 * automatically on unambiguous signals, and everything else goes to a queue for
 * someone to look at.
 *
 * The rule that matters: a signal is only strong if it identifies *exactly one*
 * service. "Domain renewal" on an invoice for a client with six domains says
 * nothing about which one.
 */
import { domainOf } from "@/lib/websites";
import { periodForDate, periodFrom, gapDays, type Period } from "@/lib/recurring";

/**
 * How far an invoice may sit from a renewal date and still be auto-applied.
 * Renewals are normally invoiced within a few weeks either side. Further out it
 * may well still be the right period — an agency billing everything in one
 * January batch, say — but that's a judgement call, so it goes to the queue.
 */
const AUTO_APPLY_GAP_DAYS = 90;

/**
 * How far a line's amount may stray from what the service costs and still be
 * auto-applied.
 *
 * This matters more than it looks. A single invoice routinely reads:
 *
 *   Domain name registration for acme.wales          £20.00
 *   Hosting service for period 15-05-26 to 14-05-27  £95.00
 *   Website design and development for acme.wales   £626.50
 *
 * Two of those name the domain, but only one is its renewal. Without a price
 * sanity check the build charge is indistinguishable from the renewal, and
 * booking it as such marks the domain billed — hiding exactly the money leak
 * this feature exists to find.
 */
const AMOUNT_MAX_MULTIPLE = 3;
const AMOUNT_MIN_MULTIPLE = 0.25;

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

export type MatchableLine = {
  id: string;
  xeroInvoiceId: string;
  lineIndex: number;
  xeroNumber: string | null;
  invoiceDate: Date;
  status: string;
  description: string;
  reference: string | null;
  quantity: number;
  lineAmount: number;
  /** Already-extracted registrable domains (parsed from the stored JSON). */
  domains: string[];
};

export type MatchableService = {
  id: string;
  kind: string;
  label: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  renewalDate: Date | null;
  termMonths: number;
};

export type BillingProposal = {
  lineId: string;
  serviceId: string;
  serviceLabel: string;
  confidence: MatchConfidence;
  reason: string;
  period: Period;
  /** Days between the invoice and the renewal it's been snapped to. */
  gapDays: number;
  amount: number;
  /** Non-null only when it would actually change the stored sell price. */
  suggestedSellPrice: number | null;
  /** Safe to write without a human looking. */
  auto: boolean;
  /** The line's wording matches the service's own kind, not just its domain. */
  kindAgrees: boolean;
};

export type MatchOutcome = {
  proposals: BillingProposal[];
  /** Lines no service claimed — shown so they can be linked by hand. */
  unmatchedLineIds: string[];
};

/** Shape a stored invoice-line row into what the matcher wants. */
export function toMatchableLine(line: {
  id: string;
  xeroInvoiceId: string;
  lineIndex: number;
  xeroNumber: string | null;
  invoiceDate: Date;
  status: string;
  description: string;
  reference: string | null;
  quantity: number;
  lineAmount: number;
  domains: string | null;
}): MatchableLine {
  let domains: string[] = [];
  if (line.domains) {
    try {
      const parsed: unknown = JSON.parse(line.domains);
      if (Array.isArray(parsed)) domains = parsed.filter((d): d is string => typeof d === "string");
    } catch {
      domains = [];
    }
  }
  return { ...line, domains };
}

/**
 * Words that identify what a line is for, when the domain isn't named.
 *
 * Bilingual because the invoices are. Roughly a fifth of the recurring lines in
 * the ledger are written in Welsh — "Gwe-letya pecyn safonol", "Cofrestru enw
 * parth cered.cymru" — and an English-only list reads those as unidentifiable.
 * They usually still match on the domain, so the effect isn't a missed link but
 * something subtler: `kindAgrees` comes back false, and that flag decides which
 * line wins a contested period in resolveContention. Getting it wrong books the
 * build charge and leaves the renewal looking unpaid.
 */
const KIND_KEYWORDS: Record<string, RegExp> = {
  DOMAIN: /\b(domain|registration|registrar|renewal of|dns|parth|cofrestru)\b/i,
  HOSTING: /\b(hosting|gwe-?letya|web ?host|server|vps|cpanel|bandwidth)\b/i,
  O365: /\b(office ?365|microsoft ?365|m365|o365|exchange|mailbox|licence|license|tanysgrifiad)\b/i,
  // Care plans are sold under a shelf of different names — Essentials, Booster,
  // Growth, Elevator — so the plan names matter as much as the words "care
  // plan". The Welsh half ("pecyn gofal gwe", "gofal safonol") is not a
  // translation of one English phrase but its own set of wordings.
  CAREPLAN:
    /(care plan|care package|maintenance package|pecyn gofal|gofal gwe|gofal safonol|cynllun gofal|\b(essentials|booster|growth|elevator)\b.{0,24}\b(plan|package|care)\b)/i,
};

/**
 * Work that is nothing to do with a domain, hosting or an O365 licence.
 *
 * The register tracks three things bought in and resold on a renewal date. Care
 * plans, social media retainers, marketing, design and training are all real
 * revenue, but none of them renew against a `RecurringService`, so a proposal
 * naming one is noise at best. At worst it's a false positive: a line reading
 * "Monthly care plan for seakayakoban.com" carries a domain name, which is the
 * matcher's strongest signal, and would otherwise be offered against that site's
 * hosting.
 *
 * Measured on the ledger, these account for the bulk of the 4,592 unlinked
 * lines — 66 × "pecyn gofal gwe", 61 × "month of the Shout social media
 * management", and so on. Bilingual for the same reason KIND_KEYWORDS is.
 */
const NOT_RECURRING = new RegExp(
  [
    "social media",
    "cyfryngau cymdeithasol",
    "digital marketing",
    "marchnata",
    "ads budget",
    "website design",
    "dylunio",
    "wordpress training",
    "hyfforddiant",
    "virtual office",
    "swyddfa rithwir",
    "office rent",
    "less deposit",
    "blaendal",
  ].join("|"),
  "i"
);

/**
 * Should this line be left out of matching altogether?
 *
 * Only when the wording names non-recurring work *and* says nothing about a
 * domain, hosting or a licence. A line that mentions both — "Hosting and care
 * plan for x.com" — is still worth proposing, because the hosting half is
 * genuinely ours; the guard is there so the exclusion can never swallow a real
 * renewal that happens to sit in a bundled description.
 */
export function isNotRecurringWork(text: string): boolean {
  if (!NOT_RECURRING.test(text)) return false;
  return !Object.values(KIND_KEYWORDS).some((re) => re.test(text));
}

/**
 * Does the wording point at a *different* kind than this service?
 *
 * Used to stop a confident-looking domain match landing on the wrong service.
 * Only fires when the line names exactly one kind and that kind isn't the
 * service's — wording that mentions several, or none, says nothing useful.
 */
function namesOtherKind(text: string, kind: string): boolean {
  const named = Object.entries(KIND_KEYWORDS)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
  return named.length === 1 && named[0] !== kind;
}

/** The single kind a line's wording points at — for explaining a downgrade. */
function otherKindLabel(text: string): string {
  const named = Object.entries(KIND_KEYWORDS)
    .filter(([, re]) => re.test(text))
    .map(([k]) => k);
  return (named[0] ?? "different").toLowerCase();
}

/** Escape a label so it can be matched literally inside a description. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Roughly what a year of this service should cost the client. Sell price when we
 * know it, otherwise what we pay — better than nothing for the sanity check.
 * Null when the service carries no price at all and no judgement is possible.
 */
function expectedAmount(service: MatchableService): number | null {
  if (service.sellPrice > 0) return service.sellPrice * (service.quantity || 1);
  if (service.costPrice > 0) return service.costPrice;
  return null;
}

function amountIsPlausible(line: MatchableLine, service: MatchableService): boolean {
  const expected = expectedAmount(service);
  if (expected === null) return true;
  return (
    line.lineAmount <= expected * AMOUNT_MAX_MULTIPLE &&
    line.lineAmount >= expected * AMOUNT_MIN_MULTIPLE
  );
}

/**
 * What the line implies the unit sell price should be. A line covering 5 O365
 * seats at £9 each is a £45 line — the service's price is per seat.
 */
function unitPriceFrom(line: MatchableLine, service: MatchableService): number {
  const qty = service.quantity > 0 && Math.abs(line.quantity - service.quantity) < 0.001
    ? service.quantity
    : 1;
  return Math.round((line.lineAmount / qty) * 100) / 100;
}

/**
 * The period a line covers for a service. Snaps to the service's own renewal
 * anniversary so the result is deterministic and re-scanning is idempotent;
 * services with no renewal date fall back to the invoice date.
 */
function periodFor(line: MatchableLine, service: MatchableService): Period | null {
  if (service.renewalDate) return periodForDate(service, line.invoiceDate);
  return periodFrom(line.invoiceDate, service.termMonths || 12);
}

/**
 * Propose which service each invoice line paid for.
 *
 * `services` should be the services of one website (or one client) — the
 * "exactly one candidate" tests below are only meaningful within that scope.
 * Lines already reviewed are expected to be filtered out by the caller.
 */
export function matchInvoiceLines(lines: MatchableLine[], services: MatchableService[]): MatchOutcome {
  const proposals: BillingProposal[] = [];
  const unmatchedLineIds: string[] = [];

  // Domain → services carrying it, so we can insist on a unique claimant.
  const byDomain = new Map<string, MatchableService[]>();
  for (const service of services) {
    const domain = domainOf(service.label);
    if (!domain) continue;
    const bucket = byDomain.get(domain);
    if (bucket) bucket.push(service);
    else byDomain.set(domain, [service]);
  }

  const byKind = new Map<string, MatchableService[]>();
  for (const service of services) {
    const bucket = byKind.get(service.kind);
    if (bucket) bucket.push(service);
    else byKind.set(service.kind, [service]);
  }

  for (const line of lines) {
    // Design, training, social media, marketing, office rent: real work, but
    // nothing here renews against it. Skipped before matching rather than
    // scored and rejected, because these lines routinely carry a domain name
    // ("MOT for noblecharitabletrust.co.uk") and the domain is the matcher's
    // strongest signal — left in, they'd be offered against that site's hosting.
    if (isNotRecurringWork(`${line.description} ${line.reference ?? ""}`)) {
      unmatchedLineIds.push(line.id);
      continue;
    }

    const hit = matchOne(line, services, byDomain, byKind);
    if (!hit) {
      unmatchedLineIds.push(line.id);
      continue;
    }

    const period = periodFor(line, hit.service);
    if (!period) {
      unmatchedLineIds.push(line.id);
      continue;
    }

    const gap = gapDays(period, line.invoiceDate);
    const unit = unitPriceFrom(line, hit.service);
    const priceDiffers = unit > 0 && Math.abs(unit - hit.service.sellPrice) > 0.01;
    const plausible = amountIsPlausible(line, hit.service);

    let reason = hit.reason;
    if (!plausible) {
      reason = `${hit.reason} — but ${fmt(line.lineAmount)} doesn't look like a renewal of this`;
    } else if (gap > AUTO_APPLY_GAP_DAYS) {
      reason = `${hit.reason} — but invoiced ${gap} days from that renewal`;
    }

    proposals.push({
      lineId: line.id,
      serviceId: hit.service.id,
      serviceLabel: hit.service.label,
      confidence: hit.confidence,
      reason,
      period,
      gapDays: gap,
      amount: line.lineAmount,
      suggestedSellPrice: priceDiffers ? unit : null,
      auto: hit.confidence === "HIGH" && gap <= AUTO_APPLY_GAP_DAYS && plausible,
      kindAgrees: hit.kindAgrees,
    });
  }

  return { proposals: resolveContention(proposals, services), unmatchedLineIds };
}

const fmt = (n: number) => `£${n.toFixed(2)}`;

/**
 * One period of one service can only have been paid by one line, so when
 * several claim it, at most one may auto-apply.
 *
 * Without this the last write wins silently: on the invoice above, both the £20
 * renewal and the £626.50 build name the domain, and whichever is processed
 * last becomes the billing record. The winner is the line that reads like the
 * service's own kind, then the one closest to its expected price.
 */
function resolveContention(
  proposals: BillingProposal[],
  services: MatchableService[]
): BillingProposal[] {
  const expectedById = new Map(services.map((s) => [s.id, expectedAmount(s)]));
  const groups = new Map<string, BillingProposal[]>();

  for (const p of proposals) {
    const key = `${p.serviceId}@${p.period.start.getTime()}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }

  for (const bucket of groups.values()) {
    const contenders = bucket.filter((p) => p.auto);
    if (contenders.length < 2) continue;

    const expected = expectedById.get(contenders[0].serviceId) ?? null;
    const score = (p: BillingProposal) => {
      const distance = expected === null ? 0 : Math.abs(p.amount - expected);
      return { kind: p.kindAgrees ? 0 : 1, distance };
    };

    const ranked = [...contenders].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      return sa.kind - sb.kind || sa.distance - sb.distance;
    });

    for (const loser of ranked.slice(1)) {
      loser.auto = false;
      loser.reason = `${loser.reason} — another line on this invoice is a closer fit for that period`;
    }
  }

  return proposals;
}

type Hit = {
  service: MatchableService;
  confidence: MatchConfidence;
  reason: string;
  kindAgrees: boolean;
};

function matchOne(
  line: MatchableLine,
  services: MatchableService[],
  byDomain: Map<string, MatchableService[]>,
  byKind: Map<string, MatchableService[]>
): Hit | null {
  // Kind is judged from the line's own description only. The reference is set
  // per *invoice* — a real one reads "dcplumbing-website-hosting-domain" — so
  // letting it vote would tag every line on the invoice as a domain charge.
  const text = line.description;
  const agrees = (service: MatchableService) => KIND_KEYWORDS[service.kind]?.test(text) ?? false;

  /* 1 — the line names the domain, and exactly one service holds it. */
  for (const domain of line.domains) {
    const candidates = byDomain.get(domain);
    if (candidates?.length === 1) {
      const only = candidates[0];
      // Naming the domain is strong evidence about the *site*, not about which
      // of its services was paid for. Being the sole service holding a domain
      // doesn't make it the answer when the line says otherwise: invoice 7466
      // reads "Domain registration for pennau.co.uk £20.00", and the only
      // service carrying pennau.co.uk is the hosting. Booking that would mark
      // hosting billed and lose the domain charge — two errors from one match.
      // The domain service is usually just missing from the register, which is
      // itself worth seeing, so this goes to the queue rather than applying.
      if (namesOtherKind(text, only.kind)) {
        return {
          service: only,
          confidence: "LOW",
          reason: `Names ${domain}, but reads like a ${otherKindLabel(text)} charge and this is ${only.kind.toLowerCase()}`,
          kindAgrees: false,
        };
      }
      return {
        service: only,
        confidence: "HIGH",
        reason: `Invoice line names ${domain}`,
        kindAgrees: agrees(only),
      };
    }
    if (candidates && candidates.length > 1) {
      // Named, but several services share the domain (domain + hosting for the
      // same site). Prefer the one whose kind the wording agrees with, and only
      // treat it as certain if exactly one does.
      const agreeing = candidates.filter(agrees);
      if (agreeing.length === 1) {
        return {
          service: agreeing[0],
          confidence: "HIGH",
          reason: `Names ${domain} and reads like ${agreeing[0].kind.toLowerCase()}`,
          kindAgrees: true,
        };
      }
      return {
        service: candidates[0],
        confidence: "LOW",
        reason: `Names ${domain}, but ${candidates.length} services share it`,
        kindAgrees: false,
      };
    }
  }

  /* 2 — the description quotes the service label verbatim. */
  const verbatim = services.filter((s) =>
    new RegExp(`(^|[^a-z0-9.-])${escapeRe(s.label)}([^a-z0-9.-]|$)`, "i").test(line.description)
  );
  if (verbatim.length === 1) {
    return {
      service: verbatim[0],
      confidence: "HIGH",
      reason: `Description mentions “${verbatim[0].label}”`,
      kindAgrees: agrees(verbatim[0]),
    };
  }

  /* 3 — the description says what kind of thing it is, and only one fits. */
  for (const [kind, re] of Object.entries(KIND_KEYWORDS)) {
    if (!re.test(text)) continue;
    const candidates = byKind.get(kind);
    if (candidates?.length === 1) {
      return {
        service: candidates[0],
        confidence: "MEDIUM",
        reason: `Looks like a ${kind.toLowerCase()} charge, and this is the only one here`,
        kindAgrees: true,
      };
    }
  }

  return null;
}
