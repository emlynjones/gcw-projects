import Link from "next/link";
import { runLinkScan, applyAiDecisions, aiDisambiguate } from "@/app/link-scan-actions";
import { serviceKindLabel } from "@/lib/recurring";
import ScanTable from "./ScanTable";

export const dynamic = "force-dynamic";

/**
 * A second pass at the invoice lines nothing has been able to place.
 *
 * The strict matcher wants a domain in the text. Most of what's left doesn't
 * have one — it says "Standard website hosting from 3rd November 2024" and
 * leaves the client to identify it. This proposes links from the client and the
 * kind of thing, grades how sure it is, and lets you apply them in bulk.
 */
export default async function LinkScanPage({
  searchParams,
}: {
  searchParams: Promise<{
    linked?: string;
    priced?: string;
    scanError?: string;
    aiDone?: string;
    aiOf?: string;
  }>;
}) {
  const { linked, priced, scanError, aiDone, aiOf } = await searchParams;
  const summary = await applyAiDecisions(await runLinkScan());

  const counts = {
    HIGH: summary.rows.filter((r) => r.confidence === "HIGH").length,
    MEDIUM: summary.rows.filter((r) => r.confidence === "MEDIUM").length,
    LOW: summary.rows.filter((r) => r.confidence === "LOW").length,
  };
  const value = summary.rows.reduce((n, r) => n + r.amount, 0);

  return (
    <>
      <div className="page-head">
        <h1>Suggested links</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/invoices/review" className="btn btn-secondary">
            Review queue
          </Link>
          <Link href="/recurring/dashboard" className="btn btn-secondary">
            Recurring
          </Link>
        </div>
      </div>

      {linked && (
        <div className="success-msg">
          Linked {linked} line(s) to services
          {Number(priced) > 0 &&
            `, and set a sell price on ${priced} service(s) from what was actually charged`}
          . They now count as billed for their period.
          <div className="small mt">
            Expect the number of unbilled years to <em>rise</em> on the dashboard, not fall. A
            service with no invoices at all has no history to judge, so its past shows as
            &ldquo;no record&rdquo;. Linking one old invoice establishes when it started being
            billed — and the years either side of it that never were. That&apos;s the picture
            getting sharper, not worse.
          </div>
        </div>
      )}
      {aiDone !== undefined && (
        <div className="success-msg">
          AI settled {aiDone} of {aiOf} ambiguous line(s). They&apos;re marked below and still need
          your tick — nothing was applied.
        </div>
      )}
      {scanError && <div className="error-msg">{scanError}</div>}

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="label">Proposals</div>
            <div className="value">{summary.rows.length}</div>
            <div className="muted small">£{value.toFixed(2)} of invoice lines</div>
          </div>
          <div className="stat">
            <div className="label">Confident</div>
            <div className="value">{counts.HIGH}</div>
            <div className="muted small">domain named, or the price matches</div>
          </div>
          <div className="stat">
            <div className="label">Likely</div>
            <div className="value">{counts.MEDIUM}</div>
            <div className="muted small">only one service it could be</div>
          </div>
          <div className="stat">
            <div className="label">Needs a decision</div>
            <div className="value">{counts.LOW}</div>
            <div className="muted small">several services fit</div>
          </div>
        </div>

        <p className="muted small">
          Scanned {summary.scanned} unlinked line(s). {summary.notRecurring} describe one-off work
          rather than a renewal and were left alone. Linking a line records it as billed for its
          period, so it stops showing as a gap.
        </p>

        {counts.LOW > 0 && (
          <form action={aiDisambiguate} style={{ display: "inline-block" }}>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!summary.aiConfigured}>
              Ask AI about the {counts.LOW} unclear one(s)
            </button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              {summary.aiConfigured
                ? "Only these are sent, and only to choose between the candidates already listed. Nothing is applied without your tick."
                : "Add an API key in Settings to enable this."}
            </span>
          </form>
        )}
      </div>

      {summary.missingTotal > 0 && (
        <div className="card">
          <h2>No service to link to — {summary.missingTotal} line(s)</h2>
          <p className="muted small">
            These name something recurring, but the client has no service of that kind in the
            register, so there&apos;s nothing to link them to. They point at gaps in the register
            rather than gaps in the invoicing:{" "}
            {Object.entries(summary.missingByKind)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${n} ${serviceKindLabel(k).toLowerCase()}`)
              .join(", ")}
            .
          </p>
          <p className="muted small">
            The care plans are the bulk of it — they&apos;re billed through Xero repeating invoices
            and were never added here. Worth adding the ones still running.
          </p>
        </div>
      )}

      <ScanTable rows={summary.rows} />
    </>
  );
}
