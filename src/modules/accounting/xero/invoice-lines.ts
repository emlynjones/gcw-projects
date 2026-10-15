import { prisma } from "@/lib/prisma";
import { extractDomains } from "@/lib/domains";
import { getContactInvoicesSince, parseXeroDate } from "@/lib/xero";

const HISTORY_YEARS = 3;

/**
 * Refresh one client's invoice-line cache without overwriting review choices.
 *
 * This is an accounting integration operation used by both the global ledger
 * sync and website reconciliation. It intentionally contains no authentication,
 * redirects, or cache revalidation; those belong to the calling adapter.
 */
export async function syncClientInvoiceLines(
  clientId: string,
  xeroContactId: string
): Promise<{ invoices: number; lines: number; domains: string[] }> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - HISTORY_YEARS);

  const invoices = await getContactInvoicesSince(xeroContactId, since);
  const found = new Set<string>();
  let lines = 0;

  for (const invoice of invoices) {
    const invoiceDate = parseXeroDate(invoice.Date) ?? new Date();
    const items = invoice.LineItems ?? [];

    for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
      const line = items[lineIndex];
      const description = (line.Description ?? "").trim();
      if (!description) continue;

      const domains = extractDomains(`${description} ${invoice.Reference ?? ""}`);
      domains.forEach((domain) => found.add(domain));

      const data = {
        xeroNumber: invoice.InvoiceNumber ?? null,
        contactId: invoice.Contact?.ContactID ?? xeroContactId,
        clientId,
        invoiceDate,
        status: invoice.Status,
        reference: invoice.Reference ?? null,
        description,
        quantity: line.Quantity ?? 1,
        unitAmount: line.UnitAmount ?? 0,
        lineAmount: line.LineAmount ?? (line.Quantity ?? 1) * (line.UnitAmount ?? 0),
        itemCode: line.ItemCode ?? null,
        domains: domains.length ? JSON.stringify(domains) : null,
        syncedAt: new Date(),
      };

      await prisma.xeroInvoiceLine.upsert({
        where: {
          xeroInvoiceId_lineIndex: {
            xeroInvoiceId: invoice.InvoiceID,
            lineIndex,
          },
        },
        update: data,
        create: { xeroInvoiceId: invoice.InvoiceID, lineIndex, ...data },
      });
      lines++;
    }
  }

  return { invoices: invoices.length, lines, domains: [...found] };
}
