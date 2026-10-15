"use client";

import { useMemo, useState } from "react";
import { xeroInvoiceUrl } from "@/lib/xero-links";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

export type ClientInvoiceLine = {
  id: string;
  lineIndex: number;
  description: string;
  quantity: number;
  lineAmount: number;
  serviceLabel: string | null;
  serviceKind: string | null;
};

export type ClientInvoice = {
  xeroInvoiceId: string;
  xeroNumber: string | null;
  invoiceDate: Date;
  status: string;
  total: number;
  lines: ClientInvoiceLine[];
};

const PAGE = 15;

/**
 * The client's invoice history, line by line.
 *
 * Invoices collapse to one row and open to show their lines, because the useful
 * question is usually "what have I charged this client for" rather than "what
 * did invoice 7080 come to" — and with 5.5 years of history a flat list of every
 * line is unreadable.
 */
export default function ClientInvoices({ invoices }: { invoices: ClientInvoice[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [page, setPage] = useState(0);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (linkedOnly && !inv.lines.some((l) => l.serviceLabel)) return false;
      if (!q) return true;
      return (
        (inv.xeroNumber ?? "").toLowerCase().includes(q) ||
        inv.lines.some(
          (l) =>
            l.description.toLowerCase().includes(q) ||
            (l.serviceLabel ?? "").toLowerCase().includes(q)
        )
      );
    });
  }, [invoices, search, linkedOnly]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * PAGE, current * PAGE + PAGE);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOpen = slice.length > 0 && slice.every((i) => open.has(i.xeroInvoiceId));

  if (!invoices.length) {
    return (
      <p className="muted">
        No invoice history. Import the Xero exports on the invoices page to populate this.
      </p>
    );
  }

  return (
    <>
      <div className="filters">
        <a
          href="#"
          className={!linkedOnly ? "active" : undefined}
          onClick={(e) => {
            e.preventDefault();
            setLinkedOnly(false);
            setPage(0);
          }}
        >
          All ({invoices.length})
        </a>
        <a
          href="#"
          className={linkedOnly ? "active" : undefined}
          onClick={(e) => {
            e.preventDefault();
            setLinkedOnly(true);
            setPage(0);
          }}
        >
          With a linked service ({invoices.filter((i) => i.lines.some((l) => l.serviceLabel)).length})
        </a>
        <input
          type="search"
          placeholder="Search description or invoice…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          style={{ marginLeft: "auto", maxWidth: 260 }}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    for (const i of slice) {
                      if (allOpen) next.delete(i.xeroInvoiceId);
                      else next.add(i.xeroInvoiceId);
                    }
                    return next;
                  })
                }
                title={allOpen ? "Collapse these" : "Expand these"}
              >
                {allOpen ? "−" : "+"}
              </button>
            </th>
            <th>Invoice</th>
            <th>Date</th>
            <th>Status</th>
            <th className="num">Lines</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {slice.map((inv) => {
            const isOpen = open.has(inv.xeroInvoiceId);
            const url = xeroInvoiceUrl(inv.xeroInvoiceId);
            return (
              <>
                <tr key={inv.xeroInvoiceId}>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggle(inv.xeroInvoiceId)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "−" : "+"}
                    </button>
                  </td>
                  <td>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" title="Open in Xero">
                        {inv.xeroNumber ?? "—"}
                      </a>
                    ) : (
                      (inv.xeroNumber ?? "—")
                    )}
                  </td>
                  <td>{dateFmt(inv.invoiceDate)}</td>
                  <td>
                    <span className={`badge badge-xero-${inv.status}`}>{inv.status}</span>
                  </td>
                  <td className="num">{inv.lines.length}</td>
                  <td className="num">{gbp(inv.total)}</td>
                </tr>
                {isOpen &&
                  inv.lines.map((l) => (
                    <tr key={l.id} className="sub-row">
                      <td />
                      <td colSpan={3} className="small">
                        {l.description}
                      </td>
                      <td className="num small">{l.quantity !== 1 ? `× ${l.quantity}` : ""}</td>
                      <td className="num small">{gbp(l.lineAmount)}</td>
                    </tr>
                  ))}
                {isOpen &&
                  inv.lines
                    .filter((l) => l.serviceLabel)
                    .map((l) => (
                      <tr key={`${l.id}-svc`} className="sub-row">
                        <td />
                        <td colSpan={5} className="small muted">
                          ↳ line {l.lineIndex} billed {l.serviceKind} · {l.serviceLabel}
                        </td>
                      </tr>
                    ))}
              </>
            );
          })}
        </tbody>
      </table>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ← Previous
          </button>
          <span className="muted small">
            Page {current + 1} of {pages} · {shown.length} invoices
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
