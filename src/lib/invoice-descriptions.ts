/**
 * Invoice line wording, in the house style.
 *
 * Every phrase here is copied from what has actually been sent: 5,448 lines of
 * history were grouped by shape to find the dominant form for each kind. So
 * hosting reads "Hosting account for x.co.uk from 3rd November 2024 to 3rd
 * November 2025" because that is the most common wording on real invoices, not
 * because it seemed reasonable.
 *
 * Pure — no Prisma, no Xero — so the builder in the browser previews exactly
 * the text the server will send.
 *
 * Note the ledger is roughly 40% Welsh ("Gwe-letya ar gyfer x o … i …",
 * "Cofrestru enw parth: x"). Nothing here records which clients get Welsh
 * invoices, so everything generates English and is editable before sending.
 */

/** "3rd November 2024" — the form used across the sales ledger. */
export function invoiceDate(d: Date): string {
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const month = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(d);
  return `${day}${suffix} ${month} ${d.getFullYear()}`;
}

export type Period = { start: Date; end: Date };

/** "from 3rd November 2024 to 3rd November 2025" */
export const periodPhrase = (p: Period) => `from ${invoiceDate(p.start)} to ${invoiceDate(p.end)}`;

/**
 * Wording for a recurring service.
 *
 * `label` is the domain for domains and hosting, and a plan or licence name
 * otherwise. Dates are appended only when a period is known — a line that
 * invents a term it can't evidence is worse than one that omits it.
 */
export function recurringDescription(
  kind: string,
  label: string,
  period?: Period | null,
  quantity = 1
): string {
  const span = period ? ` ${periodPhrase(period)}` : "";
  switch (kind) {
    case "DOMAIN":
      return `Domain name registration for ${label}${span}`;
    case "HOSTING":
      return `Hosting account for ${label}${span}`;
    case "O365": {
      const seats = quantity > 1 ? `${quantity} × ` : "";
      return `${seats}${label}${span}`;
    }
    case "CAREPLAN":
      // Care plans bill a calendar month at a time; the plan name carries the
      // tier ("Booster care plan"), so the label alone reads correctly.
      return period
        ? `${label} for one calendar month ${periodPhrase(period)}`
        : `${label} for one calendar month from the invoice date`;
    default:
      return `${label}${span}`;
  }
}

/** The project fee itself — deposit, interim or closing balance. */
export function projectFeeDescription(
  title: string,
  part: "DEPOSIT" | "BALANCE" | "FULL",
  depositPct?: number
): string {
  if (part === "DEPOSIT") {
    return `Website design and development for ${title} — deposit${
      depositPct ? ` of ${depositPct}%` : ""
    }`;
  }
  if (part === "BALANCE") return `Website design and development for ${title} — balance of project fee`;
  return `Website design and development for ${title}`;
}

/**
 * A one-line summary of what an ad-hoc job actually involved.
 *
 * Built from what the project already records rather than asking for it again:
 * the scope text if there is one, otherwise the most recent note. The point is
 * a line someone can recognise on a statement months later — "General Website
 * Work" tells nobody anything, where "…to set up the photo competition form"
 * does. Hours are appended because ad-hoc work is usually sold by the hour and
 * the client will look for them.
 */
export function adhocDescription(input: {
  title: string;
  description?: string | null;
  briefText?: string | null;
  latestNote?: string | null;
  hours?: number | null;
}): string {
  const summary = firstSentence(input.description) ?? firstSentence(input.briefText) ?? firstSentence(input.latestNote);
  const hours = input.hours ? ` (${trimNumber(input.hours)} hrs)` : "";

  if (!summary) return `${input.title}${hours}`;
  // Don't repeat the title when the scope text already opens with it.
  const lead = summary.toLowerCase().startsWith(input.title.toLowerCase())
    ? summary
    : `${input.title} — ${lowerFirst(summary)}`;
  return `${clamp(lead, 240)}${hours}`;
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** First sentence of a free-text field, tidied — invoices aren't the place for a paragraph. */
function firstSentence(text?: string | null): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const stop = /(?<=[.!?])\s/.exec(flat);
  const first = stop ? flat.slice(0, stop.index) : flat;
  return first.replace(/[.\s]+$/, "") || null;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * A period running from `start` for `termMonths`, ending the day before the
 * next anniversary — "3rd Nov 2024 to 2nd Nov 2025" would be strictly correct
 * but the ledger consistently writes the anniversary itself, so that's what
 * this returns.
 */
export function periodFromStart(start: Date, termMonths = 12): Period {
  const end = new Date(start);
  end.setMonth(end.getMonth() + termMonths);
  return { start, end };
}
