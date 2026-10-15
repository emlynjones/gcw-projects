/**
 * A second pass over invoice lines the strict matcher couldn't place.
 *
 * The original matcher keys on the domain in the line's text, which is right
 * when there is one — but most unplaced lines don't carry a domain at all:
 * "Standard website hosting from 3rd November 2024 to 3rd November 2025",
 * "PIPS Essentials Care Plan from December 2025 for 12 months". The clue there
 * is the *client* plus the *kind* of thing, and for most clients that narrows to
 * exactly one service.
 *
 * Measured against the ledger, of 2,468 unplaced lines with a known client:
 * 1,176 name no service kind at all (ad-hoc work, deposits), 745 name a kind
 * their client has no service for, 400 land on exactly one candidate, and 147
 * are genuinely ambiguous between several. So the great majority of what can be
 * placed here is arithmetic, not judgement — the AI pass exists only for the
 * 147, and is asked to choose between candidates, never to invent one.
 *
 * Pure: the caller supplies the rows and applies the results.
 */

import { periodForDate, type Period } from "@/lib/recurring";

export type ScanLine = {
  id: string;
  description: string;
  clientId: string;
  clientName: string;
  lineAmount: number;
  invoiceDate: Date;
  xeroNumber: string | null;
  xeroInvoiceId: string | null;
};

export type ScanService = {
  id: string;
  clientId: string;
  kind: string;
  label: string;
  sellPrice: number;
  quantity: number;
  renewalDate: Date | null;
  termMonths: number;
};

export type ScanConfidence = "HIGH" | "MEDIUM" | "LOW";

export type LinkProposal = {
  lineId: string;
  serviceId: string;
  confidence: ScanConfidence;
  /** Why, in words, for the person deciding whether to trust it. */
  reason: string;
  /** The period this line would be booked against, if one can be worked out. */
  period: Period | null;
  /** Set when several services could have been meant. */
  alternatives: { id: string; label: string; kind: string }[];
};

export type ScanResult = {
  proposals: LinkProposal[];
  /** Lines naming a kind the client has no service for — a missing register entry. */
  missingService: { line: ScanLine; kind: string }[];
  /** Lines whose wording names no recurring kind. Left alone: they're ad-hoc work. */
  notRecurring: number;
};

/**
 * The kind of service a line's wording describes, if any.
 *
 * Bilingual because the ledger is: roughly 40% of these lines are Welsh, and a
 * matcher that only reads English silently ignores them.
 */
export function kindFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/care plan|pecyn gofal|gofal gwe|carplan/.test(t)) return "CAREPLAN";
  if (/domain|enw parth|cofrestru/.test(t)) return "DOMAIN";
  if (/hosting|gwe-?letya|gwe letya|lletya|gweinydd/.test(t)) return "HOSTING";
  if (/365|licence|license|mailbox|exchange|microsoft/.test(t)) return "O365";
  return null;
}

/**
 * One-off work that happens to mention a service noun.
 *
 * "Transfer of the website to new hosting" and "Troubleshooting malware found
 * on website" both contain "hosting"/"website" and are both jobs, not renewals.
 * The tell is that a renewal states a term — "from 3rd November 2024 to 3rd
 * November 2025" — while a job describes an action. So an action word only
 * disqualifies a line when no period is stated alongside it.
 */
const ONE_OFF_ACTION =
  /\b(transfer|migrat|troubleshoot|malware|hack|clean-?up|set ?up|install|configur|fix|repair|recover|restore|audit|report|training|hyfforddiant|symud|gosod)/i;

const STATES_A_PERIOD =
  /\b(?:from|o)\s+\S+.{0,40}?\b(?:to|i|until|hyd)\s+\S+|\b\d{1,2}\s*(?:months?|mis|blynedd|years?)\b/i;

/**
 * Is this line a renewal of something, rather than a job done once?
 *
 * Exported so the same judgement can be reused; the cost of getting it wrong is
 * booking a malware clean-up against a hosting period and calling that year
 * billed.
 */
export function looksLikeRenewal(text: string): boolean {
  if (!ONE_OFF_ACTION.test(text)) return true;
  return STATES_A_PERIOD.test(text);
}

/** Domains mentioned in the text, lowercased. */
function domainsIn(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.uk|org\.uk|me\.uk|ltd\.uk|plc\.uk|com|cymru|wales|org|net|info|uk|eu|scot|io|co)/g) ?? []
  );
}

const money = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, b * 0.02);

/**
 * Propose a service for each unplaced line.
 *
 * Confidence is earned, not assumed. A single candidate of the right kind is a
 * starting point; it becomes HIGH only when something else corroborates it —
 * the domain appears in the text, or the amount matches what that service sells
 * for. Without corroboration it stays MEDIUM, because "this client has one
 * hosting account so this hosting line must be it" is a reasonable guess and
 * nothing more.
 */
export function scanForLinks(
  lines: ScanLine[],
  services: ScanService[],
  now: Date = new Date()
): ScanResult {
  const byClient = new Map<string, ScanService[]>();
  for (const s of services) {
    const b = byClient.get(s.clientId);
    if (b) b.push(s);
    else byClient.set(s.clientId, [s]);
  }

  const proposals: LinkProposal[] = [];
  const missingService: ScanResult["missingService"] = [];
  let notRecurring = 0;

  for (const line of lines) {
    const kind = kindFromText(line.description);
    if (!kind || !looksLikeRenewal(line.description)) {
      notRecurring++;
      continue;
    }

    const candidates = (byClient.get(line.clientId) ?? []).filter((s) => s.kind === kind);
    if (!candidates.length) {
      missingService.push({ line, kind });
      continue;
    }

    const domains = domainsIn(line.description);
    // A domain named in the text beats everything else — it's the thing the
    // strict matcher looks for, and when it's present there's no guessing.
    const byDomain = candidates.filter((s) =>
      domains.some((d) => s.label.toLowerCase() === d || s.label.toLowerCase().includes(d))
    );

    const chosen = byDomain.length === 1 ? byDomain[0] : candidates.length === 1 ? candidates[0] : null;

    if (!chosen) {
      // Several plausible services. Narrow by amount if exactly one matches what
      // the line was actually charged, otherwise leave it for a human or the AI
      // pass — a coin flip written to the database is worse than no proposal.
      const byAmount = candidates.filter((s) => money(line.lineAmount, s.sellPrice * (s.quantity || 1)));
      if (byAmount.length === 1) {
        proposals.push({
          lineId: line.id,
          serviceId: byAmount[0].id,
          confidence: "MEDIUM",
          reason: `Only one of ${candidates.length} ${kind.toLowerCase()} services for ${line.clientName} is priced at £${line.lineAmount.toFixed(2)}`,
          period: periodForDate(byAmount[0], line.invoiceDate),
          alternatives: candidates
            .filter((c) => c.id !== byAmount[0].id)
            .map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
        });
      } else {
        proposals.push({
          lineId: line.id,
          serviceId: candidates[0].id,
          confidence: "LOW",
          reason: `${candidates.length} ${kind.toLowerCase()} services for ${line.clientName} could match — needs a decision`,
          period: periodForDate(candidates[0], line.invoiceDate),
          alternatives: candidates.slice(1).map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
        });
      }
      continue;
    }

    const amountMatches = money(line.lineAmount, chosen.sellPrice * (chosen.quantity || 1));
    const namedDomain = byDomain.length === 1;

    proposals.push({
      lineId: line.id,
      serviceId: chosen.id,
      confidence: namedDomain || amountMatches ? "HIGH" : "MEDIUM",
      reason: namedDomain
        ? `${chosen.label} is named in the line`
        : amountMatches
          ? `Only ${kind.toLowerCase()} service for ${line.clientName}, and £${line.lineAmount.toFixed(2)} matches its price`
          : `Only ${kind.toLowerCase()} service for ${line.clientName}`,
      period: periodForDate(chosen, line.invoiceDate),
      alternatives: [],
    });
  }

  return { proposals, missingService, notRecurring };
}

/**
 * The lines worth asking a model about: the ones where several services are
 * plausible and nothing deterministic separates them.
 *
 * Kept deliberately small. Everything decidable by domain or price is already
 * decided, so this is the residue — about 150 lines out of 5,448.
 */
export function ambiguousProposals(result: ScanResult): LinkProposal[] {
  return result.proposals.filter((p) => p.confidence === "LOW");
}
