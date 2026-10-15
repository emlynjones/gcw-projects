"use client";

import { useState } from "react";
import {
  raisePeriodInvoice,
  moveBillingPeriod,
  unallocateBilling,
  resolveBillingPeriod,
} from "@/app/website-invoice-actions";
import { xeroInvoiceUrl } from "@/lib/xero-links";
import type { PeriodGrid as Grid } from "@/lib/billing-periods";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const shortDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(d));

/**
 * The anniversary this service turns on, e.g. "30 Jul – 29 Jul".
 *
 * Every period shares the same day and month, so one line under the label
 * explains the whole row — including why a term starting in December sits in
 * that year's column rather than the next.
 */
function cycleLabel(row: { periods: { start: Date; end: Date }[]; termMonths: number }): string {
  const p = row.periods[0];
  if (!p) return "";
  const span = `${shortDate(p.start)} – ${shortDate(p.end)}`;
  return row.termMonths === 12 ? span : `${span} · every ${row.termMonths} months`;
}

/**
 * Each service's billing years, side by side.
 *
 * The point of the layout: an unbilled year is a hole in a row, not an absence
 * you have to infer from a list of what *was* invoiced. Tick the holes and bill
 * them — including years long past, which is how a renewal that was paid for
 * and never passed on finally gets charged.
 */
export default function PeriodGrid({
  websiteId,
  grid,
  canRaise,
  defaultReference,
}: {
  websiteId: string;
  grid: Grid;
  canRaise: boolean;
  defaultReference: string;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const moveAction = moveBillingPeriod.bind(null, websiteId);
  const resolveAction = resolveBillingPeriod.bind(null, websiteId);

  /**
   * The billing being re-allocated, if any.
   *
   * Moving is a two-step gesture on purpose: pick the invoice, then pick where
   * it belongs. A dropdown per cell would be quicker to build and far easier to
   * fire by accident, and this changes which year counts as paid.
   */
  const [moving, setMoving] = useState<{ serviceId: string; from: string } | null>(null);

  const key = (serviceId: string, start: Date) =>
    `${serviceId}|${new Date(start).toISOString()}`;

  const billable = grid.rows.flatMap((r) =>
    r.periods
      .filter((p) => p.state === "GAP" || p.state === "DUE" || p.state === "UNKNOWN")
      .map((p) => key(r.serviceId, p.start))
  );

  /**
   * Submit the move through a throwaway form.
   *
   * The grid itself is the raise-invoice form, and a form can't nest inside
   * another, so re-allocation posts its own rather than sharing this one — two
   * quite different actions that happen to live in the same table.
   */
  const submitMove = (serviceId: string, from: string, to: string) => {
    const fd = new FormData();
    fd.set("serviceId", serviceId);
    fd.set("from", from);
    fd.set("to", to);
    moveAction(fd);
    setMoving(null);
  };

  const submitUnallocate = (serviceId: string, from: string) => {
    const fd = new FormData();
    fd.set("serviceId", serviceId);
    fd.set("from", from);
    unallocateBilling(websiteId, fd);
    setMoving(null);
  };

  const submitResolution = (
    serviceId: string,
    start: string,
    resolution: "MISSED" | "EXTERNAL"
  ) => {
    const message =
      resolution === "MISSED"
        ? "Mark this term as deliberately missed? It will no longer be offered for invoicing."
        : "Mark this term as billed elsewhere or bundled into another charge?";
    if (!confirm(message)) return;
    const fd = new FormData();
    fd.set("serviceId", serviceId);
    fd.set("start", start);
    fd.set("resolution", resolution);
    resolveAction(fd);
  };

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (!grid.rows.length) {
    return (
      <p className="muted">
        No annual services with a renewal date yet — add a domain or hosting to see its billing
        years.
      </p>
    );
  }

  return (
    <form action={raisePeriodInvoice.bind(null, websiteId)}>
      <div style={{ overflowX: "auto" }}>
        <table className="period-grid">
          <thead>
            <tr>
              <th>Service</th>
              {grid.years.map((y) => (
                <th key={y} className="num">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.serviceId}>
                <td>
                  <span className="badge badge-match">{r.kind}</span> {r.label}
                  {r.quantity > 1 && <span className="muted small"> ×{r.quantity}</span>}
                  {r.cancelled && <span className="badge badge-stage ml-1">not renewing</span>}
                  <div className="period-cycle">{cycleLabel(r)}</div>
                </td>
                {grid.years.map((y) => {
                  const p = r.periods.find((x) => x.year === y);
                  const continuation = p
                    ? undefined
                    : r.periods.find(
                        (x) =>
                          y > x.year &&
                          y < x.year + Math.max(1, Math.ceil(r.termMonths / 12))
                      );
                  if (continuation) {
                    const span = `${shortDate(continuation.start)} – ${shortDate(continuation.end)} ${continuation.end.getFullYear()}`;
                    const sourceUrl = xeroInvoiceUrl(continuation.xeroInvoiceId);
                    return (
                      <td
                        key={y}
                        className={`period-cell ${continuation.state.toLowerCase()} period-continuation`}
                        title={`${span} — continuation of ${continuation.year}`}
                      >
                        <span className="period-continuation-mark" aria-hidden="true">↳</span>{" "}
                        {continuation.state === "BILLED" && sourceUrl ? (
                          <a href={sourceUrl} target="_blank" rel="noreferrer">covered</a>
                        ) : (
                          <span>{continuation.state === "BILLED" ? "covered" : "same term"}</span>
                        )}
                        <div className="muted small">from {continuation.year}</div>
                      </td>
                    );
                  }
                  if (!p) return <td key={y} className="period-cell" />;
                  const k = key(r.serviceId, p.start);
                  const span = `${shortDate(p.start)} – ${shortDate(p.end)} ${p.end.getFullYear()}`;

                  const iso = new Date(p.start).toISOString();
                  const isMoving =
                    moving?.serviceId === r.serviceId && moving.from === iso;
                  const isTarget =
                    moving?.serviceId === r.serviceId && moving.from !== iso;

                  if (p.state === "MISSED" || p.state === "EXTERNAL") {
                    return (
                      <td key={y} className={`period-cell ${p.state.toLowerCase()}`} title={span}>
                        <strong>{p.state === "MISSED" ? "missed" : "billed elsewhere"}</strong>
                        <button
                          type="button"
                          className="cell-action"
                          onClick={() => submitUnallocate(r.serviceId, iso)}
                        >
                          reopen
                        </button>
                      </td>
                    );
                  }

                  if (p.state === "BILLED") {
                    const url = xeroInvoiceUrl(p.xeroInvoiceId);
                    return (
                      <td
                        key={y}
                        className={`period-cell billed${isMoving ? " moving" : ""}`}
                        title={span}
                      >
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {p.xeroNumber ?? "billed"}
                          </a>
                        ) : (
                          (p.xeroNumber ?? "billed")
                        )}
                        {p.amount != null && <div className="muted small">{gbp(p.amount)}</div>}
                        {isTarget ? (
                          <button
                            type="button"
                            className="cell-action"
                            onClick={() => submitMove(r.serviceId, moving!.from, iso)}
                          >
                            swap here
                          </button>
                        ) : isMoving ? (
                          <button
                            type="button"
                            className="cell-action"
                            onClick={() => setMoving(null)}
                          >
                            cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="cell-action"
                            onClick={() => setMoving({ serviceId: r.serviceId, from: iso })}
                          >
                            move
                          </button>
                        )}
                      </td>
                    );
                  }
                  if (p.state === "CANCELLED") {
                    return (
                      <td key={y} className="period-cell cancelled" title={span}>
                        <span className="muted small">not renewing</span>
                      </td>
                    );
                  }
                  if (p.state === "FUTURE") {
                    return (
                      <td key={y} className="period-cell future" title={span}>
                        {isTarget ? (
                          <button
                            type="button"
                            className="cell-action"
                            onClick={() => submitMove(r.serviceId, moving!.from, iso)}
                          >
                            move here
                          </button>
                        ) : (
                          <span className="muted small">not due</span>
                        )}
                      </td>
                    );
                  }
                  const cls =
                    p.state === "GAP" ? "gap" : p.state === "UNKNOWN" ? "unknown" : "due";
                  const text =
                    p.state === "GAP" ? "not billed" : p.state === "UNKNOWN" ? "no record" : "due";
                  return (
                    <td key={y} className={`period-cell ${cls}`} title={span}>
                      {isTarget ? (
                        <button
                          type="button"
                          className="cell-action"
                          onClick={() => submitMove(r.serviceId, moving!.from, iso)}
                        >
                          move here
                        </button>
                      ) : (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              name="period"
                              value={k}
                              checked={picked.has(k)}
                              onChange={() => toggle(k)}
                            />{" "}
                            {text}
                          </label>
                          <div className="period-resolution-actions">
                            <button
                              type="button"
                              onClick={() => submitResolution(r.serviceId, iso, "MISSED")}
                            >
                              mark missed
                            </button>
                            <button
                              type="button"
                              onClick={() => submitResolution(r.serviceId, iso, "EXTERNAL")}
                            >
                              billed elsewhere
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moving && (
        <div className="error-msg" style={{ marginTop: 10 }}>
          Pick the year this invoice really covers — the cells in that row now read{" "}
          <strong>move here</strong>, or <strong>swap here</strong> if that year already has one.
          Only the allocation changes; the invoice in Xero keeps whatever dates it was written
          with, so edit those there too if it&apos;s still a draft.
          <div className="mt">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoving(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (
                  confirm(
                    "Clear this allocation? The period goes back to unbilled. The invoice itself is untouched — void it in Xero if it shouldn't exist."
                  )
                ) {
                  submitUnallocate(moving.serviceId, moving.from);
                }
              }}
            >
              It shouldn&apos;t be allocated at all
            </button>
          </div>
        </div>
      )}

      <div className="period-key muted small">
        <span className="period-cell billed">invoiced</span>
        <span className="period-cell external">billed elsewhere / bundled</span>
        <span className="period-cell missed">missed / written off</span>
        <span className="period-cell gap">billed other years, not this one</span>
        <span className="period-cell unknown">no billing record</span>
        <span className="period-cell due">renewal coming</span>
        <span className="period-cell future">not due yet</span>
        <span className="period-cell cancelled">cancelled</span>
      </div>

      <input type="hidden" name="reference" value={defaultReference} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button type="submit" className="btn" disabled={!canRaise || picked.size === 0}>
          Raise draft for {picked.size || "no"} period{picked.size === 1 ? "" : "s"}
        </button>
        {billable.length > 0 && picked.size === 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPicked(new Set(billable))}
          >
            Select all {billable.length} unbilled
          </button>
        )}
        {grid.totalUnknown > 0 && (
          <span className="muted small">
            &ldquo;No billing record&rdquo; means nothing here was ever matched to an invoice — it
            may have been billed outside this system. Worth checking before charging again.
          </span>
        )}
        <span className="muted small">
          One draft in Xero, a line per period. Nothing is sent — approve it there.
        </span>
      </div>
    </form>
  );
}
