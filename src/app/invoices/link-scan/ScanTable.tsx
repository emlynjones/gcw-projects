"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { applyScanSelections, type ScanRow } from "@/app/link-scan-actions";
import { xeroInvoiceUrl } from "@/lib/xero-links";
import { serviceKindLabel } from "@/lib/recurring";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

type Filter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * The proposals, ticked and applied in bulk.
 *
 * Nothing starts ticked, including the confident ones. Linking a line marks a
 * period as billed, which removes it from every "unbilled" view — a wrong link
 * doesn't just sit there, it hides a real gap. So the bulk action is
 * "select all confident", offered explicitly, rather than a pre-filled form
 * someone scrolls past.
 *
 * Where several services were possible, the alternatives are a dropdown: the
 * proposal is a starting point, not the only option.
 */
export default function ScanTable({ rows }: { rows: ScanRow[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "ALL" && r.confidence !== filter) return false;
      if (!q) return true;
      return (
        r.description.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        r.serviceLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  const toggle = (r: ScanRow) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(r.lineId)) next.delete(r.lineId);
      else next.set(r.lineId, r.serviceId);
      return next;
    });

  const choose = (lineId: string, serviceId: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(lineId)) next.set(lineId, serviceId);
      return next;
    });

  if (!rows.length) {
    return (
      <div className="card">
        <h2>Nothing to propose</h2>
        <p className="muted">
          Every unlinked line either describes one-off work or names a service the client
          doesn&apos;t have.
        </p>
      </div>
    );
  }

  const confident = rows.filter((r) => r.confidence === "HIGH");
  const pickedValue = rows
    .filter((r) => picked.has(r.lineId))
    .reduce((n, r) => n + r.amount, 0);

  return (
    <form action={applyScanSelections} className="card">
      <div className="filters">
        {(["ALL", "HIGH", "MEDIUM", "LOW"] as Filter[]).map((f) => (
          <a
            key={f}
            href="#"
            className={filter === f ? "active" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setFilter(f);
            }}
          >
            {f === "ALL"
              ? `All (${rows.length})`
              : `${f === "HIGH" ? "Confident" : f === "MEDIUM" ? "Likely" : "Unclear"} (${
                  rows.filter((r) => r.confidence === f).length
                })`}
          </a>
        ))}
        <input
          type="search"
          placeholder="Search line, client or service…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: "auto", maxWidth: 280 }}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>Invoice line</th>
            <th>Client</th>
            <th className="num">Amount</th>
            <th>Link to</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const on = picked.has(r.lineId);
            return (
              <tr key={r.lineId}>
                <td>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r)}
                    aria-label={`Link ${r.description}`}
                  />
                  {on && (
                    <input
                      type="hidden"
                      name="pair"
                      value={`${r.lineId}|${picked.get(r.lineId)}`}
                    />
                  )}
                </td>
                <td className="small">
                  {r.description}
                  <div className="muted small">
                    {xeroInvoiceUrl(r.xeroInvoiceId) ? (
                      <a
                        href={xeroInvoiceUrl(r.xeroInvoiceId)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.xeroNumber}
                      </a>
                    ) : (
                      r.xeroNumber
                    )}{" "}
                    · {dateFmt(r.invoiceDate)}
                    {r.periodStart && r.periodEnd && (
                      <>
                        {" "}
                        · would cover {dateFmt(r.periodStart)} – {dateFmt(r.periodEnd)}
                      </>
                    )}
                  </div>
                </td>
                <td className="small">
                  <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                </td>
                <td className="num">{gbp(r.amount)}</td>
                <td className="small">
                  {r.alternatives.length ? (
                    <select
                      value={picked.get(r.lineId) ?? r.serviceId}
                      onChange={(e) => choose(r.lineId, e.target.value)}
                      disabled={!on}
                    >
                      {[
                        { id: r.serviceId, label: r.serviceLabel, kind: r.serviceKind },
                        ...r.alternatives,
                      ].map((c) => (
                        <option key={c.id} value={c.id}>
                          {serviceKindLabel(c.kind)} · {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <span className="badge badge-match">
                        {serviceKindLabel(r.serviceKind)}
                      </span>{" "}
                      {r.serviceLabel}
                    </>
                  )}
                </td>
                <td className="small muted">
                  <span
                    className={
                      r.confidence === "HIGH"
                        ? "badge badge-match"
                        : r.confidence === "LOW"
                          ? "badge badge-stage"
                          : "badge"
                    }
                  >
                    {r.confidence === "HIGH" ? "confident" : r.confidence === "LOW" ? "unclear" : "likely"}
                  </span>{" "}
                  {r.reason}
                  {r.fromAi && <div className="muted small">chosen by AI — check it</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button type="submit" className="btn" disabled={picked.size === 0}>
          Link {picked.size || "no"} line{picked.size === 1 ? "" : "s"}
          {picked.size > 0 && ` — ${gbp(pickedValue)}`}
        </button>
        {confident.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              setPicked(new Map(confident.map((r) => [r.lineId, r.serviceId])))
            }
          >
            Select the {confident.length} confident
          </button>
        )}
        {picked.size > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPicked(new Map())}
          >
            Clear
          </button>
        )}
        <span className="muted small">
          Linking marks the line&apos;s period as billed, so it stops showing as a gap.
        </span>
      </div>
    </form>
  );
}
