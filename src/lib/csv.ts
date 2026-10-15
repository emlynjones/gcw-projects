/**
 * Minimal RFC 4180 CSV parser — no dependency.
 *
 * Supplier exports (123 Reg, Cloud.Market, a hosting spreadsheet saved as CSV)
 * are messy in predictable ways: a UTF-8 BOM from Excel, CRLF line endings,
 * quoted fields containing commas or newlines, and doubled quotes as escapes.
 * All of those are handled here so the import UI can assume clean rows.
 *
 * Isomorphic on purpose: the browser parses the file for the mapping preview,
 * and the server can re-parse the same text if it ever needs to.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

/** Split raw CSV text into a header row and data rows. */
export function parseCsv(text: string, delimiter = ","): ParsedCsv {
  const src = text.replace(/^﻿/, ""); // Excel BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Drop rows that are entirely empty (trailing newline, blank separator lines).
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a lone CR
      if (src[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush whatever is left (file not ending in a newline).
  if (field !== "" || row.length) endRow();

  if (!rows.length) return { headers: [], rows: [] };
  const [headers, ...body] = rows;
  return { headers: headers.map((h) => h.trim()), rows: body };
}

/**
 * Guess which source column maps to a target field, by fuzzy header match.
 * Returns the column index, or -1. Candidates are tried in order, so put the
 * most specific first ("renewal date" before "date").
 *
 * `taken` holds columns already claimed by a higher-priority field. Guessing is
 * exclusive because header names overlap across fields — a hosting sheet's
 * "Account" column is the service name, but "account" also reads like a
 * provider reference, and whichever field asks first would otherwise win.
 */
export function guessColumn(
  headers: string[],
  candidates: string[],
  taken: ReadonlySet<number> = new Set()
): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalised = headers.map(norm);
  const free = (i: number) => i !== -1 && !taken.has(i) && normalised[i] !== "";

  for (const candidate of candidates) {
    const c = norm(candidate);
    const exact = normalised.findIndex((h, i) => h === c && !taken.has(i));
    if (free(exact)) return exact;
  }
  for (const candidate of candidates) {
    const c = norm(candidate);
    // Short candidates are barred from substring matching: "id" lives inside
    // "Paid", which is how a hosting sheet's paid-flag column got claimed as the
    // provider reference. Anything this short must match a header exactly.
    if (c.length < 4) continue;
    const partial = normalised.findIndex((h, i) => !taken.has(i) && (h.includes(c) || c.includes(h)));
    if (free(partial)) return partial;
  }
  return -1;
}

/**
 * Work out what separates the columns.
 *
 * Spreadsheet exports and copy-paste out of Excel are tab-separated far more
 * often than people expect, and parsing a TSV as CSV doesn't fail — it silently
 * yields one enormous column, which then maps to nonsense. Picking the
 * separator that produces the most columns on the header line is crude and
 * reliable.
 */
export function detectDelimiter(text: string): string {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    // Count on the parsed header so quoted separators aren't miscounted.
    const count = parseCsv(header, d).headers.length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse a money-ish cell: strips currency symbols, thousands separators and
 * stray whitespace. "£1,234.50" → 1234.5, "" → null, "n/a" → null.
 */
export function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a date cell across the formats suppliers actually emit.
 * Handles ISO (2027-03-14), UK slash/dot (14/03/2027, 14.03.2027) and
 * "14 Mar 2027". UK ordering is assumed for ambiguous slash dates, because
 * every source here is UK.
 */
export function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;

  // ISO first — unambiguous.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return mk(+iso[1], +iso[2], +iso[3]);

  // d/m/y or d.m.y or d-m-y, 2- or 4-digit year.
  const uk = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (uk) {
    const year = +uk[3] < 100 ? 2000 + +uk[3] : +uk[3];
    return mk(year, +uk[2], +uk[1]);
  }

  // "14 Mar 2027" / "14 March 2027"
  const named = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(s);
  if (named) {
    const month = MONTHS.findIndex((m) => named[2].toLowerCase().startsWith(m));
    if (month !== -1) return mk(+named[3], month + 1, +named[1]);
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function mk(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers like 31 Feb.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}
