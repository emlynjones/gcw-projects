"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createCarePlanServices, type CarePlanRow } from "@/app/careplan-actions";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(d));

type View = "all" | "clear" | "lapsed" | "check";

/**
 * Care-plan candidates, ticked to create.
 *
 * Nothing starts ticked. Each of these creates a billing commitment against a
 * real client, so the decision should be one someone made rather than one they
 * failed to undo — and a screen that opens with thirty rows already selected is
 * read as a list to skim, not a list to judge. Filter, then tick the page.
 */
export default function CarePlanQueue({ rows, view: initialView }: { rows: CarePlanRow[]; view: string }) {
  const [view, setView] = useState<View>((initialView as View) ?? "all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const isLapsed = (r: CarePlanRow) =>
    r.occurrences >= 6 && r.monthsSinceLast >= 2 && r.monthsSinceLast <= 12;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === "clear" && r.confidence !== "CLEAR") return false;
      if (view === "check" && r.confidence !== "CHECK") return false;
      if (view === "lapsed" && !isLapsed(r)) return false;
      if (!q) return true;
      return (
        r.clientName.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.samples.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [rows, view, search]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.key));
  const toggleShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShownPicked) next.delete(r.key);
        else next.add(r.key);
      }
      return next;
    });

  const pickedRows = rows.filter((r) => picked.has(r.key));
  const pickedValue = pickedRows.reduce((n, r) => n + r.monthlyPrice * 12, 0);

  if (!rows.length) {
    return (
      <div className="card">
        <h2>Nothing to create</h2>
        <p className="muted">
          Every care plan found in the invoice history already has a service. Import more invoices
          or check <Link href="/recurring">the register</Link>.
        </p>
      </div>
    );
  }

  const counts = {
    all: rows.length,
    clear: rows.filter((r) => r.confidence === "CLEAR").length,
    lapsed: rows.filter(isLapsed).length,
    check: rows.filter((r) => r.confidence === "CHECK").length,
  };

  return (
    <form action={createCarePlanServices}>
      <div className="card">
        <div className="filters">
          {(["all", "clear", "lapsed", "check"] as View[]).map((v) => (
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
                : v === "clear"
                  ? `Ready (${counts.clear})`
                  : v === "lapsed"
                    ? `Stopped (${counts.lapsed})`
                    : `Check (${counts.check})`}
            </a>
          ))}
          <input
            type="search"
            placeholder="Search client or wording…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: "auto", maxWidth: 260 }}
          />
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allShownPicked}
                  onChange={toggleShown}
                  title="Tick everything shown"
                />
              </th>
              <th>Client</th>
              <th>Proposed service</th>
              <th className="num">Monthly</th>
              <th className="num">Charges</th>
              <th>Billed</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td>
                  <input
                    type="checkbox"
                    name="create"
                    value={r.key}
                    checked={picked.has(r.key)}
                    onChange={() => toggle(r.key)}
                  />
                </td>
                <td>
                  <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                </td>
                <td>
                  {r.label}
                  {r.websiteName && <div className="muted small">→ {r.websiteName}</div>}
                </td>
                <td className="num">{gbp(r.monthlyPrice)}</td>
                <td className="num">{r.occurrences}</td>
                <td>
                  {dateFmt(r.firstSeen)} – {dateFmt(r.lastSeen)}
                  {r.monthsSinceLast >= 2 && (
                    <div className={r.monthsSinceLast <= 12 ? "paid-no" : "muted small"}>
                      {r.monthsSinceLast <= 12
                        ? `stopped ${r.monthsSinceLast} months ago`
                        : `ended ${Math.round(r.monthsSinceLast / 12)}y ago`}
                    </div>
                  )}
                </td>
                <td className="small">
                  <span className={r.confidence === "CLEAR" ? "muted" : "paid-no"}>{r.reason}</span>
                  <div className="muted small" title={r.samples.join("\n")}>
                    {r.samples[0]?.slice(0, 60)}
                    {(r.samples[0]?.length ?? 0) > 60 ? "…" : ""}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && <p className="muted">Nothing matches that filter.</p>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button type="submit" className="btn" disabled={picked.size === 0}>
            Create {picked.size} care plan{picked.size === 1 ? "" : "s"}
          </button>
          {picked.size > 0 && (
            <span className="muted">
              {gbp(pickedValue)}/year · historic charges are booked at the same time, so these
              won&apos;t show as never-billed
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
