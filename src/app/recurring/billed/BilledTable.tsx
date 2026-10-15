"use client";

import { xeroInvoiceUrl } from "@/lib/xero-links";

import { useMemo, useState } from "react";
import Link from "next/link";
import { gbp } from "@/lib/status";

export type BilledDomainRow = {
  domain: string;
  clientId: string | null;
  clientName: string | null;
  /** More than one client billed for this domain — needs a human decision. */
  contested: boolean;
  lastBilledDisplay: string;
  lastAmount: number;
  timesBilled: number;
  lastDescription: string;
  lastInvoiceNumber: string | null;
  lastInvoiceId: string | null;
  tracked: boolean;
};

export default function BilledTable({ rows }: { rows: BilledDomainRow[] }) {
  const [query, setQuery] = useState("");
  const [onlyUntracked, setOnlyUntracked] = useState(false);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    let out = rows;
    if (onlyUntracked) out = out.filter((r) => !r.tracked);
    if (q) {
      out = out.filter(
        (r) =>
          r.domain.includes(q) ||
          r.clientName?.toLowerCase().includes(q) ||
          r.lastDescription.toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, q, onlyUntracked]);

  const untracked = rows.filter((r) => !r.tracked).length;

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} className="mt">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search domains, clients or descriptions…"
          style={{ maxWidth: 320 }}
        />
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={onlyUntracked}
            onChange={(e) => setOnlyUntracked(e.target.checked)}
            style={{ width: "auto" }}
          />
          Only not-yet-tracked ({untracked})
        </label>
      </div>

      <p className="muted small mt">{filtered.length} domain(s) shown</p>

      <table className="mt">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Billed to</th>
            <th>Last billed</th>
            <th className="num">Last amount</th>
            <th className="num">Times</th>
            <th>Last line</th>
            <th>Tracked</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.domain}>
              <td>{r.domain}</td>
              <td>
                {r.clientId ? (
                  <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                ) : (
                  <span className="muted">—</span>
                )}
                {r.contested && (
                  <span className="badge badge-life-LOST ml-1" title="Billed to more than one client">
                    multiple
                  </span>
                )}
              </td>
              <td className="muted small">
                {r.lastBilledDisplay}
                {r.lastInvoiceNumber && (
                  <div className="small">
                    {xeroInvoiceUrl(r.lastInvoiceId) ? (
                      <a
                        href={xeroInvoiceUrl(r.lastInvoiceId)!}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in Xero"
                      >
                        #{r.lastInvoiceNumber}
                      </a>
                    ) : (
                      <>#{r.lastInvoiceNumber}</>
                    )}
                  </div>
                )}
              </td>
              <td className="num">{gbp(r.lastAmount)}</td>
              <td className="num">{r.timesBilled}</td>
              <td className="muted small">{r.lastDescription}</td>
              <td>
                {r.tracked ? (
                  <span className="badge badge-life-COMPLETE">Tracked</span>
                ) : (
                  <span className="badge badge-life-LOST">Not tracked</span>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                {q || onlyUntracked ? "No matches." : "No billed domains found yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
