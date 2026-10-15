"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { gbp } from "@/lib/status";
import { serviceKindLabel, billingStateLabel } from "@/lib/recurring";
import { setServiceCancelled, setServiceInternal } from "@/app/recurring-actions";

export type RecurringRow = {
  id: string;
  kind: string;
  label: string;
  provider: string | null;
  quantity: number;
  annualCost: number;
  annualSell: number;
  renewalDate: string | null; // pre-formatted ISO — the period maths runs on the server
  renewalDisplay: string;
  periodDisplay: string;
  daysUntil: number | null;
  state: string;
  active: boolean;
  managedBy: string;
  cancelledAt: string | null;
  clientId: string | null;
  clientName: string | null;
  websiteName: string | null;
  websiteId: string | null;
};

export default function RecurringTable({ rows }: { rows: RecurringRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.clientName?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q) ||
        r.websiteName?.toLowerCase().includes(q)
    );
  }, [rows, q]);

  const financial = filtered.filter((r) => r.active && r.state !== "NOT_BILLABLE");
  const totalSell = financial.reduce((s, r) => s + r.annualSell, 0);
  const totalCost = financial.reduce((s, r) => s + r.annualCost, 0);

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search services, clients or providers…"
        className="mt"
        style={{ maxWidth: 320 }}
      />

      <p className="muted small mt">
        {filtered.length} shown · {gbp(totalSell)} annual · {gbp(totalCost)} cost ·{" "}
        <strong>{gbp(totalSell - totalCost)} margin</strong>
      </p>

      <table className="mt">
        <thead>
          <tr>
            <th>Service</th>
            <th>Type</th>
            <th>Client</th>
            <th>Provider</th>
            <th>Renews</th>
            <th className="num">Cost</th>
            <th className="num">Sell</th>
            <th>This period</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
              <td>
                {r.label}
                {r.websiteName && (
                  <div className="muted small">
                    {r.websiteId ? (
                      <Link href={`/websites/${r.websiteId}`}>{r.websiteName}</Link>
                    ) : (
                      r.websiteName
                    )}
                  </div>
                )}
                {!r.active && <span className="badge ml-1">inactive</span>}
                {r.cancelledAt && <span className="badge ml-1">cancelled · no renewal</span>}
                {r.managedBy === "INTERNAL" && (
                  <span className="badge ml-1">ours · not invoiced</span>
                )}
                {r.kind === "DOMAIN" && (
                  <form action={setServiceInternal.bind(null, r.id, r.managedBy !== "INTERNAL")}>
                    <button type="submit" className="btn-link muted small">
                      {r.managedBy === "INTERNAL" ? "Make customer-billable" : "Mark as ours"}
                    </button>
                  </form>
                )}
              </td>
              <td>
                <span className="badge badge-type">{serviceKindLabel(r.kind)}</span>
              </td>
              <td>
                {r.clientId ? (
                  <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                ) : (
                  <span className="badge badge-life-LOST">Unassigned</span>
                )}
              </td>
              <td className="muted small">{r.provider ?? "—"}</td>
              <td className="muted small">
                {r.renewalDate ? (
                  <>
                    {r.renewalDisplay}
                    {r.daysUntil !== null && r.daysUntil <= 60 && (
                      <span className="badge ml-1">{r.daysUntil <= 0 ? "due" : `${r.daysUntil}d`}</span>
                    )}
                    <div className="small">{r.periodDisplay}</div>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="num">{gbp(r.annualCost)}</td>
              <td className="num">{gbp(r.annualSell)}</td>
              <td>
                <span
                  className={`badge ${r.state === "BILLED" || r.state === "NOT_BILLABLE" ? "badge-life-COMPLETE" : r.state === "REVIEW" ? "badge-review" : "badge-life-LOST"}`}
                >
                  {billingStateLabel(r.state)}
                </span>
                <form action={setServiceCancelled.bind(null, r.id, !r.cancelledAt)}>
                  <button type="submit" className="btn-link muted small mt">
                    {r.cancelledAt ? "Resume renewals" : "Cancel future renewals"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                {q ? `No matches for "${query.trim()}".` : "Nothing here."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
