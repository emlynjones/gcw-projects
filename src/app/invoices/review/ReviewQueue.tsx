"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { applyReviewSelections } from "@/app/invoice-review-actions";
import type { QueueRow } from "@/app/invoice-review-actions";
import { xeroInvoiceUrl as xeroUrl } from "@/lib/xero-links";

const PAGE_SIZE = 20;

const CONFIDENCE_BADGE: Record<string, string> = {
  HIGH: "badge-life-COMPLETE",
  MEDIUM: "badge-match",
  LOW: "badge-stage",
};

const money = (n: number) => `£${n.toFixed(2)}`;
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(d));

type View = "auto" | "all" | "HIGH" | "MEDIUM" | "LOW";

export default function ReviewQueue({ rows }: { rows: QueueRow[] }) {
  // Confirmed rows are tracked rather than "unconfirmed", so nothing is ever
  // written because a checkbox happened to default to on.
  const [confirm, setConfirm] = useState<Set<string>>(new Set());
  const [otherWork, setOtherWork] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("auto");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const counts = useMemo(
    () => ({
      auto: rows.filter((r) => r.auto).length,
      all: rows.length,
      HIGH: rows.filter((r) => r.confidence === "HIGH").length,
      MEDIUM: rows.filter((r) => r.confidence === "MEDIUM").length,
      LOW: rows.filter((r) => r.confidence === "LOW").length,
    }),
    [rows]
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (view === "auto" && !r.auto) return false;
        if (view !== "auto" && view !== "all" && r.confidence !== view) return false;
        if (!q) return true;
        return (
          r.clientName.toLowerCase().includes(q) ||
          r.serviceLabel.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          (r.xeroNumber ?? "").toLowerCase().includes(q)
        );
      }),
    [rows, view, q]
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const key = (r: QueueRow) => `${r.lineId}:${r.serviceId}`;

  function toggleConfirm(r: QueueRow, on: boolean) {
    const next = new Set(confirm);
    const nextOtherWork = new Set(otherWork);
    if (on) {
      next.add(key(r));
      nextOtherWork.delete(r.lineId);
    } else next.delete(key(r));
    setConfirm(next);
    setOtherWork(nextOtherWork);
  }

  function toggleOtherWork(r: QueueRow, on: boolean) {
    const next = new Set(otherWork);
    const nextConfirm = new Set(confirm);
    if (on) {
      next.add(r.lineId);
      nextConfirm.delete(key(r));
    } else next.delete(r.lineId);
    setOtherWork(next);
    setConfirm(nextConfirm);
  }

  const pageKeys = shown.map(key);
  const allPageConfirmed = pageKeys.length > 0 && pageKeys.every((k) => confirm.has(k));

  function togglePage(on: boolean) {
    const next = new Set(confirm);
    const nextOtherWork = new Set(otherWork);
    for (const r of shown) {
      if (on) {
        next.add(key(r));
        nextOtherWork.delete(r.lineId);
      } else next.delete(key(r));
    }
    setConfirm(next);
    setOtherWork(nextOtherWork);
  }

  function tickAllFiltered() {
    const next = new Set(confirm);
    const nextOtherWork = new Set(otherWork);
    for (const r of filtered) {
      next.add(key(r));
      nextOtherWork.delete(r.lineId);
    }
    setConfirm(next);
    setOtherWork(nextOtherWork);
  }

  const chip = (v: View, label: string, n: number) => (
    <a
      key={v}
      href="#"
      className={view === v ? "active" : ""}
      onClick={(e) => {
        e.preventDefault();
        setView(v);
        setPage(0);
      }}
    >
      {label} ({n})
    </a>
  );

  return (
    <form action={applyReviewSelections} className="stack">
      <div className="filters">
        {chip("auto", "Safe to apply", counts.auto)}
        {chip("all", "Everything", counts.all)}
        {chip("HIGH", "Strong", counts.HIGH)}
        {chip("MEDIUM", "Likely", counts.MEDIUM)}
        {chip("LOW", "Weak", counts.LOW)}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Filter by client, service, invoice or wording…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          style={{ flex: "1 1 260px" }}
        />
        <button type="button" className="btn btn-sm btn-secondary" onClick={tickAllFiltered}>
          Tick all {filtered.length} shown
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => {
            setConfirm(new Set());
            setOtherWork(new Set());
          }}
        >
          Clear
        </button>
      </div>

      {view === "auto" && (
        <p className="muted small">
          These name one service unambiguously, sit close to the renewal they&apos;ve been matched
          to, and are priced like the thing they claim to pay for. Anything failing one of those
          three is under the other tabs.
        </p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={allPageConfirmed}
                ref={(el) => {
                  if (el) el.indeterminate = !allPageConfirmed && pageKeys.some((k) => confirm.has(k));
                }}
                onChange={(e) => togglePage(e.target.checked)}
                title="Confirm everything on this page"
              />
            </th>
            <th>Invoice line</th>
            <th>Pays for</th>
            <th>Period</th>
            <th className="num">Amount</th>
            <th>Why</th>
            <th style={{ width: 90 }}>Other work</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const url = xeroUrl(r.xeroInvoiceId);
            return (
              <tr key={key(r)}>
                <td>
                  <input
                    type="checkbox"
                    checked={confirm.has(key(r))}
                    onChange={(e) => toggleConfirm(r, e.target.checked)}
                  />
                </td>
                <td>
                  <div className="small">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {r.xeroNumber ?? "invoice"}
                      </a>
                    ) : (
                      <span title="Not in the Xero index yet">{r.xeroNumber ?? "invoice"}</span>
                    )}{" "}
                    <span className="muted">{fmtDate(r.invoiceDate)}</span>
                  </div>
                  <div className="muted small">{r.description}</div>
                  <div className="small">
                    <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                  </div>
                </td>
                <td>
                  <div>{r.serviceLabel}</div>
                  <div className="muted small">{r.serviceKind}</div>
                  {r.suggestedSellPrice !== null && (
                    <div className="small">sets sell {money(r.suggestedSellPrice)}</div>
                  )}
                </td>
                <td className="small">
                  {r.periodLabel}
                  {r.gapDays > 90 && (
                    <div className="muted small">{r.gapDays} days from renewal</div>
                  )}
                </td>
                <td className="num">{money(r.amount)}</td>
                <td className="small">
                  <span className={`badge ${CONFIDENCE_BADGE[r.confidence] ?? ""}`}>
                    {r.confidence}
                  </span>{" "}
                  <span className="muted">{r.reason}</span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={otherWork.has(r.lineId)}
                    onChange={(e) => toggleOtherWork(r, e.target.checked)}
                    title="Keep in Xero history, but do not treat as recurring-service billing"
                  />
                </td>
              </tr>
            );
          })}
          {!shown.length && (
            <tr>
              <td colSpan={7} className="muted">
                Nothing here.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
          >
            Previous
          </button>
          <span className="muted small">
            Page {current + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
          >
            Next
          </button>
        </div>
      )}

      {[...confirm].map((k) => (
        <input key={k} type="hidden" name="confirm" value={k} />
      ))}
      {[...otherWork].map((id) => (
        <input key={id} type="hidden" name="otherWork" value={id} />
      ))}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn" type="submit" disabled={!confirm.size && !otherWork.size}>
          Apply {confirm.size} link{confirm.size === 1 ? "" : "s"}
          {otherWork.size ? `, mark ${otherWork.size} as other work` : ""}
        </button>
        <span className="muted small">Selections carry across pages and filters.</span>
      </div>
    </form>
  );
}
