"use client";

import { useState } from "react";
import { raiseWebsiteInvoice, resnapBillingPeriods } from "@/app/website-invoice-actions";
import type { BillableLine } from "@/lib/billing-raise";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

/**
 * Raise one draft invoice covering this site's renewals.
 *
 * Nothing is ticked on open, matching the rest of the app: an invoice is a
 * decision, and a pre-ticked list is skimmed rather than read. Services already
 * billed for their period, and those with no sell price, are shown but can't be
 * selected — seeing why something isn't billable is more use than it vanishing.
 */
export default function RaiseInvoice({
  websiteId,
  services,
  defaultReference,
}: {
  websiteId: string;
  services: BillableLine[];
  defaultReference: string;
}) {
  const billable = services.filter((s) => !s.nothingOwing && !s.noPrice && !s.priceLooksWrong);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const total = services
    .filter((s) => picked.has(s.id))
    .reduce((n, s) => n + s.lineTotal, 0);

  if (!services.length) {
    return <p className="muted">No active services on this site to invoice.</p>;
  }

  const drifted = services.filter((s) => s.drift);

  return (
    <>
      {drifted.map((s) => (
        <div className="error-msg" key={`drift-${s.id}`}>
          <strong>{s.label}</strong>&apos;s recorded billing history starts{" "}
          <strong>{dateFmt(s.drift!.billedFrom)}</strong>, {s.drift!.days} days from its renewal
          date. Billing periods are worked out from the renewal date, so a history imported against
          an older date sits in the wrong place — and the stale period can overlap the year that
          genuinely needs invoicing, which is why nothing is offered here.
          <form
            action={resnapBillingPeriods.bind(null, websiteId, s.id)}
            style={{ display: "inline-block", marginLeft: 8 }}
          >
            <button type="submit" className="btn btn-sm">
              Rebuild billing periods from the renewal date
            </button>
          </form>
          <div className="muted small">
            This moves the recorded periods only. The renewal date is left alone — it comes from
            your supplier, and it&apos;s the half more likely to be right.
          </div>
        </div>
      ))}

      <form action={raiseWebsiteInvoice.bind(null, websiteId)} onSubmit={() => setBusy(true)}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={billable.length > 0 && billable.every((s) => picked.has(s.id))}
                onChange={(e) =>
                  setPicked(e.target.checked ? new Set(billable.map((s) => s.id)) : new Set())
                }
                title="Tick everything billable"
                disabled={!billable.length}
              />
            </th>
            <th>Service</th>
            <th>Period</th>
            <th className="num">Amount</th>
            <th>Bills as</th>
          </tr>
        </thead>
        <tbody>
          {services.map((s) => {
            const blocked = s.nothingOwing || s.noPrice || s.priceLooksWrong;
            return (
              <tr key={s.id} className={blocked ? "muted" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    name="service"
                    value={s.id}
                    checked={picked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    disabled={blocked}
                  />
                </td>
                <td>
                  <span className="badge badge-match">{s.kindLabel}</span> {s.label}
                  <div className="muted small">{s.description}</div>
                </td>
                <td className="small">
                  {s.periodStart && s.periodEnd ? (
                    <>
                      {dateFmt(s.periodStart)} – {dateFmt(s.periodEnd)}
                      {s.advance ? (
                        <div className="muted small">
                          renews in {s.daysUntilStart} day{s.daysUntilStart === 1 ? "" : "s"} —
                          billing ahead
                        </div>
                      ) : (
                        s.daysUntilStart < 0 && (
                          <div className="paid-no small">
                            already running, never invoiced
                          </div>
                        )
                      )}
                    </>
                  ) : s.nothingOwing ? (
                    <span className="muted">covered</span>
                  ) : (
                    <span className="paid-no">no renewal date</span>
                  )}
                </td>
                <td className="num">
                  {s.noPrice ? <span className="paid-no">no price</span> : gbp(s.lineTotal)}
                  {s.quantity > 1 && !s.noPrice && (
                    <div className="muted small">
                      {s.quantity} × {gbp(s.unitPrice ?? 0)}
                    </div>
                  )}
                </td>
                <td className="small">
                  {s.xeroItemCode ? (
                    <code>{s.xeroItemCode}</code>
                  ) : (
                    <span className="muted">default account</span>
                  )}
                  {s.nothingOwing && (
                    <div className="muted small">covered — next renewal not due yet</div>
                  )}
                  {s.priceLooksWrong && (
                    <div className="paid-no small">
                      {gbp(s.annualCost)} cost — price looks wrong, can&apos;t bill
                    </div>
                  )}
                  {s.kind === "CAREPLAN" && !s.nothingOwing && (
                    <div className="muted small">
                      care plans usually bill from a Xero repeating invoice — check before adding
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="field mt" style={{ maxWidth: 320 }}>
        <label htmlFor="reference">Reference</label>
        <input id="reference" name="reference" defaultValue={defaultReference} />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button type="submit" className="btn" disabled={busy || picked.size === 0}>
          {busy
            ? "Creating…"
            : `Raise draft invoice${picked.size ? ` — ${picked.size} line${picked.size === 1 ? "" : "s"}, ${gbp(total)}` : ""}`}
        </button>
        <span className="muted small">
          One draft in Xero with a line per service. Nothing is sent — approve and send from Xero.
        </span>
      </div>
      </form>
    </>
  );
}
