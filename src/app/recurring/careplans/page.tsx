import Link from "next/link";
import { buildCarePlanQueue } from "@/app/careplan-actions";
import { gbp, dateFmt } from "@/lib/status";
import CarePlanQueue from "./CarePlanQueue";

export const dynamic = "force-dynamic";

export default async function CarePlansPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; linked?: string; view?: string }>;
}) {
  const { created, linked, view } = await searchParams;
  const summary = await buildCarePlanQueue();

  const open = summary.rows.filter((r) => !r.alreadyTracked);
  const tracked = summary.rows.length - open.length;

  return (
    <>
      <div className="page-head">
        <h1>Care plans found in invoices</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/reports/recurring" className="btn btn-secondary">
            Not yet billed
          </Link>
          <Link href="/recurring" className="btn btn-secondary">
            Back to services
          </Link>
        </div>
      </div>

      {created && (
        <div className="success-msg">
          Created {created} care plan service{created === "1" ? "" : "s"} and booked {linked ?? 0}{" "}
          historic charge{linked === "1" ? "" : "s"} against them.
        </div>
      )}

      <div className="card">
        <p className="muted">
          Monthly care plans have never been tracked as services, so none of this revenue appears in
          the billing register. These are read back out of {" "}
          <Link href="/invoices/review">the invoice history</Link> — nothing is created until you
          tick it.
        </p>
        <div className="stats">
          <div>
            <div className="label">Ready to create</div>
            <div className="value">{summary.clearCount}</div>
            <div className="muted">{gbp(summary.clearAnnualValue)}/year</div>
          </div>
          <div>
            <div className="label">Stopped being billed</div>
            <div className="value">{summary.lapsedCount}</div>
            <div className="muted">
              {summary.lapsedValue > 0 ? `~${gbp(summary.lapsedValue)} missed` : "none"}
            </div>
          </div>
          <div>
            <div className="label">Need checking</div>
            <div className="value">{open.filter((r) => r.confidence === "CHECK").length}</div>
            <div className="muted">price or dates unclear</div>
          </div>
          <div>
            <div className="label">Already tracked</div>
            <div className="value">{tracked}</div>
            <div className="muted">service exists</div>
          </div>
        </div>
        {summary.lapsedCount > 0 && (
          <p className="paid-no">
            {summary.lapsedCount} plan{summary.lapsedCount === 1 ? " has" : "s have"} a long billing
            history that stopped in the last year. A plan billed faithfully for years and then not
            at all is more often a missed invoice than a cancellation — worth checking before
            creating it.
          </p>
        )}
      </div>

      <CarePlanQueue rows={open} view={view ?? "all"} />

      {tracked > 0 && (
        <div className="card">
          <h2>Already tracked ({tracked})</h2>
          <p className="muted small">
            A care plan service already exists for this client at this price.
          </p>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Plan</th>
                <th className="num">Monthly</th>
                <th className="num">Charges</th>
                <th>Last billed</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows
                .filter((r) => r.alreadyTracked)
                .map((r) => (
                  <tr key={r.key}>
                    <td>
                      <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                    </td>
                    <td>{r.label}</td>
                    <td className="num">{gbp(r.monthlyPrice)}</td>
                    <td className="num">{r.occurrences}</td>
                    <td>{dateFmt(r.lastSeen)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
