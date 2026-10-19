import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildReviewQueue, confirmAllAuto } from "@/app/invoice-review-actions";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ applied?: string; linked?: string; otherWork?: string; prices?: string }>;
}) {
  const { applied, linked, otherWork, prices } = await searchParams;

  const [rows, totalLines, linkedLines] = await Promise.all([
    buildReviewQueue(),
    prisma.xeroInvoiceLine.count(),
    prisma.xeroInvoiceLine.count({ where: { recurringServiceId: { not: null } } }),
  ]);

  const autoCount = rows.filter((r) => r.auto).length;

  return (
    <>
      <div className="page-head">
        <h1>Review invoice matches</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/invoices/link-scan" className="btn btn-secondary">
            Suggested links
          </Link>
          <Link href="/reports/recurring" className="btn btn-secondary">
            Not-billed report
          </Link>
          <Link href="/invoices/import" className="btn btn-secondary">
            Import more
          </Link>
        </div>
      </div>

      {applied === "1" && (
        <div className="success-msg">
          Linked {linked} line{linked === "1" ? "" : "s"}
          {otherWork && otherWork !== "0" ? `, marked ${otherWork} as other work` : ""}
          {prices && prices !== "0" ? `, set ${prices} sell price${prices === "1" ? "" : "s"}` : ""}.
        </div>
      )}

      <p className="muted">
        {linkedLines.toLocaleString()} of {totalLines.toLocaleString()} imported lines are linked to
        a service. Marking a line as <strong>Other work</strong> keeps it in the imported Xero
        history, but confirms that it does not pay for a recurring service and stops it being
        proposed again. Everything below is a proposal until you confirm it.
      </p>

      {totalLines === 0 ? (
        <div className="card">
          <p>
            No invoice history yet. <Link href="/invoices/import">Import your Xero exports</Link> to
            get started.
          </p>
        </div>
      ) : !rows.length ? (
        <div className="card">
          <p>Nothing left to review — every imported line has been linked or dismissed.</p>
        </div>
      ) : (
        <>
          {autoCount > 0 && (
            <div className="card">
              <h2>Apply the safe ones in one go</h2>
              <p className="muted small">
                {autoCount.toLocaleString()} line{autoCount === 1 ? "" : "s"} identify exactly one
                service, fall near the renewal they pay for, and are priced accordingly. Each writes
                a billing record, and fills the service&apos;s sell price where it&apos;s still £0.
              </p>
              <form action={confirmAllAuto}>
                <button className="btn" type="submit">
                  Link {autoCount.toLocaleString()} matched line
                  {autoCount === 1 ? "" : "s"}
                </button>
              </form>
            </div>
          )}

          <ReviewQueue rows={rows} />
        </>
      )}
    </>
  );
}
