"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { raiseClientInvoice, type ClientGroup } from "@/app/billing-run-actions";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

type View = "all" | "overdue" | "soon";

/**
 * One card per client, one form per client, one draft per client.
 *
 * Separate forms rather than one big one: raising is per-client by nature, and
 * a single form would make it far too easy to invoice the whole book by
 * pressing the wrong button. Nothing starts ticked, as everywhere else here.
 */
export default function BillingRun({
  groups,
  canRaise,
}: {
  groups: ClientGroup[];
  canRaise: boolean;
}) {
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        sites: g.sites
          .map((s) => ({
            ...s,
            lines: s.lines.filter((l) => {
              if (view === "overdue" && l.advance) return false;
              if (view === "soon" && !l.advance) return false;
              if (!q) return true;
              return (
                g.clientName.toLowerCase().includes(q) ||
                l.label.toLowerCase().includes(q) ||
                (s.websiteName ?? "").toLowerCase().includes(q)
              );
            }),
          }))
          .filter((s) => s.lines.length),
      }))
      .filter((g) => g.sites.length);
  }, [groups, view, search]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!groups.length) {
    return (
      <div className="card">
        <h2>Nothing owing</h2>
        <p className="muted">
          Every billable service is covered for its current period, and nothing renews in the next
          60 days.
        </p>
      </div>
    );
  }

  const counts = {
    all: groups.reduce((n, g) => n + g.overdue + g.dueSoon, 0),
    overdue: groups.reduce((n, g) => n + g.overdue, 0),
    soon: groups.reduce((n, g) => n + g.dueSoon, 0),
  };

  return (
    <>
      <div className="card">
        <div className="filters">
          {(["all", "overdue", "soon"] as View[]).map((v) => (
            <a
              key={v}
              href="#"
              className={view === v ? "active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setView(v);
              }}
            >
              {v === "all"
                ? `All (${counts.all})`
                : v === "overdue"
                  ? `Overdue (${counts.overdue})`
                  : `Due soon (${counts.soon})`}
            </a>
          ))}
          <input
            type="search"
            placeholder="Search client, site or service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: "auto", maxWidth: 280 }}
          />
        </div>
        {shown.length === 0 && <p className="muted">Nothing matches that filter.</p>}
      </div>

      {shown.map((g) => {
        const selectable = g.sites.flatMap((s) => s.lines).filter((l) => !l.priceLooksWrong);
        const chosen = selectable.filter((l) => picked.has(l.id));
        const total = chosen.reduce((n, l) => n + l.lineTotal, 0);
        const allPicked = selectable.length > 0 && selectable.every((l) => picked.has(l.id));

        return (
          <form key={g.clientId} action={raiseClientInvoice.bind(null, g.clientId)} className="card">
            <div className="page-head" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/clients/${g.clientId}`}>{g.clientName}</Link>
              </h2>
              <span className="muted small">
                {gbp(g.total)}
                {g.overdue > 0 && ` · ${g.overdue} overdue`}
                {g.dueSoon > 0 && ` · ${g.dueSoon} due soon`}
              </span>
            </div>

            {g.belowCost > 0 && (
              <p className="paid-no small">
                {g.belowCost} line(s) here sell for less than they cost — worth checking the price
                before it goes out again.
              </p>
            )}

            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={allPicked}
                      disabled={!selectable.length}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          for (const l of selectable) {
                            if (e.target.checked) next.add(l.id);
                            else next.delete(l.id);
                          }
                          return next;
                        })
                      }
                      title="Tick everything for this client"
                    />
                  </th>
                  <th>Service</th>
                  <th>Period</th>
                  <th className="num">Amount</th>
                  <th>Bills as</th>
                </tr>
              </thead>
              <tbody>
                {g.sites.map((site) => (
                  <>
                    <tr key={site.websiteId ?? "none"}>
                      <td />
                      <td colSpan={4} className="muted small">
                        {site.websiteId ? (
                          <Link href={`/websites/${site.websiteId}`}>{site.websiteName}</Link>
                        ) : (
                          site.websiteName
                        )}
                      </td>
                    </tr>
                    {site.lines.map((l) => (
                      <tr key={l.id} className={l.priceLooksWrong ? "muted" : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            name="service"
                            value={l.id}
                            checked={picked.has(l.id)}
                            onChange={() => toggle(l.id)}
                            disabled={l.priceLooksWrong}
                          />
                        </td>
                        <td>
                          <span className="badge badge-match">{l.kindLabel}</span> {l.label}
                          <div className="muted small">{l.description}</div>
                        </td>
                        <td className="small">
                          {l.periodStart && l.periodEnd ? (
                            <>
                              {dateFmt(l.periodStart)} – {dateFmt(l.periodEnd)}
                              <div className={l.advance ? "muted small" : "paid-no small"}>
                                {l.advance
                                  ? `renews in ${l.daysUntilStart} days`
                                  : "already running, never invoiced"}
                              </div>
                            </>
                          ) : (
                            <span className="paid-no">no renewal date</span>
                          )}
                        </td>
                        <td className="num">
                          {gbp(l.lineTotal)}
                          {l.quantity > 1 && (
                            <div className="muted small">
                              {l.quantity} × {gbp(l.unitPrice ?? 0)}
                            </div>
                          )}
                          {l.belowCost && (
                            <div className="paid-no small">below {gbp(l.annualCost)} cost</div>
                          )}
                          {l.priceLooksWrong && (
                            <div className="paid-no small">
                              {gbp(l.annualCost)} cost — price looks wrong, can&apos;t bill
                            </div>
                          )}
                        </td>
                        <td className="small">
                          {l.xeroItemCode ? (
                            <code>{l.xeroItemCode}</code>
                          ) : (
                            <span className="muted">default account</span>
                          )}
                          {l.priceSource === "product" && (
                            <div className="muted small">price from Xero</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              <input
                type="hidden"
                name="reference"
                value={`Renewals — ${new Date().toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}`}
              />
              <button type="submit" className="btn" disabled={!canRaise || chosen.length === 0}>
                Raise draft for {g.clientName.slice(0, 28)}
                {chosen.length > 0 && ` — ${chosen.length} line(s), ${gbp(total)}`}
              </button>
            </div>
          </form>
        );
      })}
    </>
  );
}
