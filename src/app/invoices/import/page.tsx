import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ImportForm from "./ImportForm";
import IndexSync from "./IndexSync";
import { invoiceIndexStatus } from "@/app/invoice-import-actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d) : null;

export default async function InvoiceImportPage() {
  const [index, lines, unreviewed] = await Promise.all([
    invoiceIndexStatus(),
    prisma.xeroInvoiceLine.count(),
    prisma.xeroInvoiceLine.count({ where: { reviewed: false } }),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Import invoice history</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {lines > 0 && (
            <Link href="/invoices/review" className="btn">
              Review {unreviewed.toLocaleString()} lines
            </Link>
          )}
          <Link href="/recurring" className="btn btn-secondary">
            Back to services
          </Link>
        </div>
      </div>

      <p className="muted">
        Past invoices are what turn the recurring register into a billing system: they say what has
        actually been charged, for which period, and at what price. Reading them from a CSV export
        costs no Xero API calls and reaches back as far as you care to export.
      </p>

      <div className="card">
        <h2>Xero invoice index</h2>
        <p className="muted small">
          An export carries every line of every invoice but no invoice ID and no contact ID — so on
          its own it can neither link back to Xero nor tell whose invoice it is. This one-off pass
          fetches both for the whole ledger, 100 invoices per call and no line items, which is a few
          dozen calls against a 5,000-a-day limit.
        </p>
        <p className="small">
          <strong>{index.total.toLocaleString()}</strong> invoices indexed
          {index.nextPage ? (
            <span className="muted"> — paused at page {index.nextPage}, run again to continue</span>
          ) : index.lastCompletedAt ? (
            <span className="muted"> — completed {fmt(index.lastCompletedAt)}</span>
          ) : (
            <span className="muted"> — not started</span>
          )}
        </p>
        <IndexSync hasCursor={index.nextPage !== null} />
      </div>

      {index.total === 0 && (
        <div className="error-msg">
          The index is empty. You can still import — lines will match and report normally — but they
          won&apos;t link through to Xero, and clients will be resolved only where the contact is
          already known. Running the index first is the better order.
        </div>
      )}

      <ImportForm />
    </>
  );
}
