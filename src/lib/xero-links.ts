/**
 * Deep links into Xero.
 *
 * Everything needed to reach an invoice has been stored all along; nothing ever
 * linked to it. One helper so the URL shape lives in a single place — Xero has
 * moved invoicing between hosts more than once, and hunting hardcoded links
 * through a dozen components afterwards is miserable.
 *
 * `View.aspx` is deliberate over the newer `invoicing.xero.com/edit/` form: it
 * resolves for any status, redirecting a draft to the editor and an authorised
 * invoice to the read view, so one link works whatever state the invoice is in.
 */
const XERO_INVOICE = "https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=";

/**
 * A line imported from CSV whose invoice wasn't in the index is stored under a
 * `csv:<number>` placeholder rather than a real GUID. There's nothing to link
 * to until the index catches up, so callers get null and render plain text.
 */
export function xeroInvoiceUrl(xeroInvoiceId: string | null | undefined): string | null {
  if (!xeroInvoiceId || xeroInvoiceId.startsWith("csv:")) return null;
  return `${XERO_INVOICE}${xeroInvoiceId}`;
}

/** Xero's contact page — used from the client record. */
export function xeroContactUrl(contactId: string | null | undefined): string | null {
  if (!contactId) return null;
  return `https://go.xero.com/Contacts/View/${contactId}`;
}
