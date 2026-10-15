/**
 * Reading a Xero "Sales Invoices" CSV export.
 *
 * The alternative is the API, and for invoice *history* it isn't practical:
 * a full pull is ~2 calls per client across 225 clients, repeated every time it
 * goes stale, and it still only reaches as far back as the sync window. A set of
 * exports costs nothing and, in this case, carries 5.5 years.
 *
 * Xero exports one row per invoice *line*, repeating the invoice header on every
 * row. The export is also date-windowed, so covering years means several files
 * with deliberately overlapping windows — which is why combining and deduping is
 * the whole job here rather than an afterthought.
 *
 * Pure: no I/O, no Prisma. The import action supplies the file text and decides
 * what to write.
 */
import { parseCsv, detectDelimiter, parseMoney, parseDate } from "@/lib/csv";
import { extractDomains } from "@/lib/domains";

/** One invoice line, normalised out of the export. */
export type InvoiceCsvLine = {
  xeroNumber: string;
  /** Position within its own invoice — see assignLineIndexes. */
  lineIndex: number;
  contactName: string;
  invoiceDate: Date;
  /** True when the date came from DueDate because InvoiceDate was blank. */
  dateInferred: boolean;
  /** Xero's internal status vocabulary, not the export's wording. */
  status: string;
  reference: string | null;
  description: string;
  quantity: number;
  unitAmount: number;
  /** Ex-VAT, as exported. */
  lineAmount: number;
  itemCode: string | null;
  domains: string[];
};

export type CombineSummary = {
  files: number;
  rawRows: number;
  /** Rows dropped because an earlier file already had them. */
  duplicates: number;
  /** Rows dropped for not being a sales invoice (credit notes, overpayments). */
  skippedType: number;
  /** Rows dropped for having no invoice number to key on. */
  skippedNoNumber: number;
  /** Rows dropped for being unparseable (no description, or no date at all). */
  skippedUnusable: number;
  /** Kept lines whose date came from DueDate — worth dating properly in Xero. */
  dateInferred: number;
  invoices: number;
  lines: number;
  firstDate: Date | null;
  lastDate: Date | null;
};

export type CombineResult = { lines: InvoiceCsvLine[]; summary: CombineSummary };

/**
 * Only true sales invoices become billing evidence.
 *
 * The export mixes in two other things. "Sales overpayment" rows are bank
 * allocations, not charges — they arrive with a blank invoice number and are the
 * only rows in the entire dataset that repeat identically within one "invoice",
 * which would defeat the dedupe key below.
 *
 * "Sales credit note" is the interesting exclusion. A credit note reverses a
 * charge, so netting it off a billing looks right — but in this ledger they are
 * almost entirely bad-debt write-offs, and a client who was invoiced and didn't
 * pay *was still invoiced*. The period is billed; the debt is a different
 * problem. Cancelling a period is a real case, but it needs a human deciding
 * that a specific service stopped, not a rule that quietly un-bills things.
 */
const SALES_INVOICE = "sales invoice";

/**
 * Export wording → Xero's own status values, so a CSV-sourced line is
 * indistinguishable from an API-sourced one downstream.
 */
const STATUS_MAP: Record<string, string> = {
  paid: "PAID",
  "awaiting payment": "AUTHORISED",
  "awaiting approval": "SUBMITTED",
  draft: "DRAFT",
  voided: "VOIDED",
  deleted: "DELETED",
};

function mapStatus(raw: string): string {
  return STATUS_MAP[raw.trim().toLowerCase()] ?? raw.trim().toUpperCase();
}

/** Column lookup by exact header name — Xero's export headers are fixed. */
function indexer(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return (name: string): number => map.get(name.toLowerCase()) ?? -1;
}

/** Does this look like a Xero sales-invoice export at all? */
export function isSalesInvoiceExport(text: string): boolean {
  const { headers } = parseCsv(text.slice(0, 8192), detectDelimiter(text));
  const at = indexer(headers);
  return at("InvoiceNumber") !== -1 && at("Description") !== -1 && at("LineAmount") !== -1;
}

/**
 * Parse one export file into lines, in file order.
 *
 * `lineIndex` is left at 0 here — it can only be assigned once every file has
 * been merged, because it must count position within an *invoice*, not a file.
 */
export function parseSalesInvoiceCsv(text: string): {
  lines: InvoiceCsvLine[];
  rawRows: number;
  skippedType: number;
  skippedNoNumber: number;
  skippedUnusable: number;
} {
  const { headers, rows } = parseCsv(text, detectDelimiter(text));
  const at = indexer(headers);

  const cNumber = at("InvoiceNumber");
  const cType = at("Type");
  const cContact = at("ContactName");
  const cDate = at("InvoiceDate");
  const cDue = at("DueDate");
  const cStatus = at("Status");
  const cReference = at("Reference");
  const cDescription = at("Description");
  const cQuantity = at("Quantity");
  const cUnit = at("UnitAmount");
  const cAmount = at("LineAmount");
  const cItem = at("InventoryItemCode");

  const lines: InvoiceCsvLine[] = [];
  let skippedType = 0;
  let skippedNoNumber = 0;
  let skippedUnusable = 0;

  const cell = (row: string[], i: number) => (i === -1 ? "" : (row[i] ?? "").trim());

  for (const row of rows) {
    if (cType !== -1 && cell(row, cType).toLowerCase() !== SALES_INVOICE) {
      skippedType++;
      continue;
    }

    const xeroNumber = cell(row, cNumber);
    if (!xeroNumber) {
      skippedNoNumber++;
      continue;
    }

    const description = cell(row, cDescription);
    // A line with nothing written on it describes no charge — invoice 7408 has
    // exactly one such line, blank with zero quantity and zero amount.
    if (!description) {
      skippedUnusable++;
      continue;
    }

    // A draft invoice can sit in Xero without a date. Dropping those loses real
    // money: invoice 7262 is £120 of WHELF hosting whose only fault is that it
    // was never dated. Fall back to the due date, and flag it so nothing treats
    // an inferred date as evidence of when the charge was actually raised.
    const stated = parseDate(cell(row, cDate));
    const invoiceDate = stated ?? parseDate(cell(row, cDue));
    if (!invoiceDate) {
      skippedUnusable++;
      continue;
    }

    const reference = cell(row, cReference) || null;
    // Domains come from the description *and* the reference because a reference
    // like "pennau-website-hosting" is often where the site is actually named.
    // Kind detection deliberately does not follow suit — see billing-match.ts.
    const domains = extractDomains(`${description} ${reference ?? ""}`);

    lines.push({
      xeroNumber,
      lineIndex: 0,
      contactName: cell(row, cContact),
      invoiceDate,
      dateInferred: !stated,
      status: mapStatus(cell(row, cStatus)),
      reference,
      description,
      quantity: parseMoney(cell(row, cQuantity)) ?? 1,
      unitAmount: parseMoney(cell(row, cUnit)) ?? 0,
      lineAmount: parseMoney(cell(row, cAmount)) ?? 0,
      itemCode: cell(row, cItem) || null,
      domains,
    });
  }

  return { lines, rawRows: rows.length, skippedType, skippedNoNumber, skippedUnusable };
}

/**
 * What makes two rows the same line.
 *
 * Position can't be part of this: the same invoice sits at different offsets in
 * different files, which is the entire reason overlapping exports produce
 * duplicates. Content is what identifies it.
 *
 * Two genuinely identical lines on one invoice would collapse into one here.
 * That is a real limitation and it was worth checking rather than assuming:
 * across all 7,254 rows supplied, the only content key repeating within a single
 * invoice belonged to the blank-numbered overpayment rows, which never get this
 * far. Line order was likewise identical in every file for every real invoice.
 */
function dedupeKey(l: InvoiceCsvLine): string {
  return [
    l.xeroNumber,
    l.invoiceDate.toISOString().slice(0, 10),
    l.description,
    l.quantity,
    l.unitAmount,
    l.lineAmount,
    l.contactName,
  ].join(" ");
}

/**
 * Number each line by its position within its own invoice.
 *
 * This pairs with `XeroInvoiceLine`'s (xeroInvoiceId, lineIndex) key, so
 * re-importing updates rows in place — and so a CSV row for an invoice already
 * pulled through the API lands on that same row instead of beside it.
 *
 * Relies on lines of one invoice keeping their relative order, which the export
 * guarantees and the dedupe above preserves by keeping first-seen order.
 */
function assignLineIndexes(lines: InvoiceCsvLine[]): void {
  const seen = new Map<string, number>();
  for (const line of lines) {
    const n = seen.get(line.xeroNumber) ?? 0;
    line.lineIndex = n;
    seen.set(line.xeroNumber, n + 1);
  }
}

/**
 * Merge several exports into one deduped, indexed set of lines.
 *
 * Files are processed in the order given and first-seen wins. They're expected
 * to overlap — that's how the windows are made to join up without a gap — so a
 * high duplicate count is a sign the export set is *complete*, not that
 * something went wrong.
 */
export function combineExports(texts: string[]): CombineResult {
  const byKey = new Map<string, InvoiceCsvLine>();
  const summary: CombineSummary = {
    files: texts.length,
    rawRows: 0,
    duplicates: 0,
    skippedType: 0,
    skippedNoNumber: 0,
    skippedUnusable: 0,
    dateInferred: 0,
    invoices: 0,
    lines: 0,
    firstDate: null,
    lastDate: null,
  };

  for (const text of texts) {
    const parsed = parseSalesInvoiceCsv(text);
    summary.rawRows += parsed.rawRows;
    summary.skippedType += parsed.skippedType;
    summary.skippedNoNumber += parsed.skippedNoNumber;
    summary.skippedUnusable += parsed.skippedUnusable;

    for (const line of parsed.lines) {
      const key = dedupeKey(line);
      if (byKey.has(key)) {
        summary.duplicates++;
        continue;
      }
      byKey.set(key, line);
    }
  }

  const lines = [...byKey.values()];

  // Group each invoice's lines together before indexing them. Insertion order
  // already keeps an invoice's lines contiguous *within* a file, but a later
  // file can carry an invoice an earlier one only partly covered.
  const order = new Map<string, number>();
  lines.forEach((l) => {
    if (!order.has(l.xeroNumber)) order.set(l.xeroNumber, order.size);
  });
  lines.sort((a, b) => (order.get(a.xeroNumber) ?? 0) - (order.get(b.xeroNumber) ?? 0));

  assignLineIndexes(lines);

  summary.lines = lines.length;
  summary.invoices = order.size;
  for (const l of lines) {
    if (l.dateInferred) summary.dateInferred++;
    if (!summary.firstDate || l.invoiceDate < summary.firstDate) summary.firstDate = l.invoiceDate;
    if (!summary.lastDate || l.invoiceDate > summary.lastDate) summary.lastDate = l.invoiceDate;
  }

  return { lines, summary };
}
