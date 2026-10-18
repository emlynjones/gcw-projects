import Link from "next/link";
import { billingRun } from "@/app/billing-run-actions";
import { getConnection } from "@/lib/xero";
import { xeroInvoiceUrl } from "@/lib/xero-links";
import BillingRun from "./BillingRun";

export const dynamic = "force-dynamic";

const money = (n: number) => `£${n.toFixed(2)}`;

/**
 * Everything owing across the whole book, grouped the way an invoice goes out.
 *
 * The screen the system exists for: the per-website page answers "what does
 * this site owe", which is the wrong question when there are 266 of them.
 */
export default async function BillingRunPage({
  searchParams,
}: {
  searchParams: Promise<{
    raised?: string;
    client?: string;
    number?: string;
    xid?: string;
    runError?: string;
  }>;
}) {
  const { raised, client, number, xid, runError } = await searchParams;
  const [run, conn] = await Promise.all([billingRun(), getConnection()]);

  return (
    <div className="billing-run-page">
      <div className="page-head">
        <h1>Billing run</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/reports/recurring" className="btn btn-secondary">
            Not yet billed
          </Link>
          <Link href="/recurring" className="btn btn-secondary">
            Services
          </Link>
        </div>
      </div>

      {raised && (
        <div className="success-msg">
          Draft{" "}
          {number && xeroInvoiceUrl(xid) ? (
            <a href={xeroInvoiceUrl(xid)!} target="_blank" rel="noreferrer">
              <strong>{number}</strong>
            </a>
          ) : (
            "invoice"
          )}{" "}
          created for <strong>{client}</strong> with {raised} line(s), and recorded against those
          periods. Approve and send it from Xero.
        </div>
      )}
      {runError && <div className="error-msg">{runError}</div>}
      {!conn && (
        <div className="error-msg">
          Xero isn&apos;t connected — connect it in <Link href="/settings">Settings</Link> before
          raising anything.
        </div>
      )}

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="label">Overdue</div>
            <div className="value">{money(run.overdueValue)}</div>
            <div className="muted">
              {run.overdueCount} line(s) already running, never invoiced
            </div>
          </div>
          <div className="stat">
            <div className="label">Due within 60 days</div>
            <div className="value">{money(run.dueSoonValue)}</div>
            <div className="muted">{run.dueSoonCount} renewal(s) to bill ahead</div>
          </div>
          <div className="stat">
            <div className="label">Blocked — no price</div>
            <div className="value">{run.noPriceCount}</div>
            <div className="muted">{money(run.noPriceCost)}/yr of cost, nothing to charge</div>
          </div>
          {run.suspectCount > 0 && (
            <div className="stat">
              <div className="label">Blocked — price looks wrong</div>
              <div className="value">{run.suspectCount}</div>
              <div className="muted">more than 10× cost — check before billing</div>
            </div>
          )}
        </div>
        <p className="muted small">
          One draft per client, covering every ticked line across their sites — the way these
          already go out. Renewals are offered up to 60 days ahead so the invoice lands before you
          pay the supplier. Care plans bill from Xero repeating invoices and aren&apos;t offered
          early.
        </p>
        {run.noPriceCount > 0 && (
          <p className="muted small">
            {run.noPriceCount} service(s) can&apos;t be billed because neither the service nor its
            Xero product carries a price —{" "}
            <Link href="/reports/recurring?view=noprice">see the list</Link>. Set the price on the
            Xero product and re-sync, or map the service to the right product in{" "}
            <Link href="/settings/xero-items">Xero products</Link>.
          </p>
        )}
      </div>

      <BillingRun groups={run.groups} canRaise={!!conn} />
    </div>
  );
}
