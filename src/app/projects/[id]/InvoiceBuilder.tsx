"use client";

import { useState } from "react";
import {
  recurringDescription,
  periodFromStart,
  invoiceDate,
} from "@/lib/invoice-descriptions";

type Service = {
  id: string;
  name: string;
  price: number;
  unit: string;
  category: string;
  xeroItemCode: string | null;
};

/** A cached Xero product, for the per-line picker. */
export type BuilderItem = { code: string; name: string };

/**
 * Which recurring kind a price-list entry represents, if any.
 *
 * Used only to decide whether a line is worth pre-filling with a domain and a
 * term. Read off the name because the price list has no kind of its own.
 */
function kindOfService(name: string): "DOMAIN" | "HOSTING" | "O365" | "CAREPLAN" | null {
  if (/care plan|gofal/i.test(name)) return "CAREPLAN";
  if (/domain|parth/i.test(name)) return "DOMAIN";
  if (/hosting|gwe-?letya/i.test(name)) return "HOSTING";
  if (/365|licence|license/i.test(name)) return "O365";
  return null;
}

/**
 * `itemCode` decides which Xero account the line lands in and stops Xero
 * rewriting the description when someone edits the item there, so it has to
 * survive the trip from the price list to the form payload. It was missing from
 * this type, which silently dropped every code the price list carried.
 */
type Line = {
  description: string;
  quantity: number;
  unitAmount: number;
  itemCode: string | null;
};

type KindOption = { value: string; label: string };

export default function InvoiceBuilder({
  services,
  items = [],
  domains = [],
  defaultReference,
  action,
  kindOptions,
  defaultKind = "",
}: {
  services: Service[];
  items?: BuilderItem[];
  /** The client's sites — used to name the domain on a hosting or domain line. */
  domains?: string[];
  defaultReference: string;
  action: (formData: FormData) => Promise<void>;
  kindOptions?: KindOption[];
  defaultKind?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(defaultKind);

  const total = lines.reduce((s, l) => s + l.quantity * l.unitAmount, 0);

  const addService = (id: string) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    const kind = kindOfService(svc.name);
    // A renewal line is worth writing out in full — "Hosting account for x.co.uk
    // from … to …" is what the client recognises, and what the matcher reads
    // back when reconciling next year. Only one site can be named automatically;
    // with several, the domain is left for the user rather than guessed.
    const domain = domains.length === 1 ? domains[0] : null;
    const term = svc.unit === "month" ? 1 : 12;
    const description =
      kind && domain
        ? recurringDescription(kind, domain, periodFromStart(new Date(), term))
        : svc.name + (svc.unit !== "one-off" ? ` (per ${svc.unit})` : "");

    setLines([
      ...lines,
      { description, quantity: 1, unitAmount: svc.price, itemCode: svc.xeroItemCode },
    ]);
  };

  const update = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        try {
          await action(fd);
          setLines([]);
        } finally {
          setBusy(false);
        }
      }}
      className="stack"
    >
      <div className="inline-form">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="svc-picker">Add service from price list</label>
          <select
            id="svc-picker"
            value=""
            onChange={(e) => {
              addService(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">— choose a service —</option>
            {categories.map((cat) => (
              <optgroup key={cat} label={cat}>
                {services
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — £{s.price}
                      {s.unit !== "one-off" ? `/${s.unit}` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            setLines([...lines, { description: "", quantity: 1, unitAmount: 0, itemCode: null }])
          }
        >
          + Custom line
        </button>
      </div>

      {lines.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 80 }}>Qty</th>
              <th style={{ width: 120 }}>Unit £ (ex-VAT)</th>
              <th style={{ width: 170 }}>Bills as</th>
              <th className="num" style={{ width: 110 }}>
                Line total
              </th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    required
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={l.quantity}
                    onChange={(e) => update(i, { quantity: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitAmount}
                    onChange={(e) => update(i, { unitAmount: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  {items.length ? (
                    <select
                      value={l.itemCode ?? ""}
                      onChange={(e) => update(i, { itemCode: e.target.value || null })}
                    >
                      <option value="">— none —</option>
                      {items.map((it) => (
                        <option key={it.code} value={it.code}>
                          {it.code} · {it.name.slice(0, 28)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small">no products synced</span>
                  )}
                </td>
                <td className="num">£{(l.quantity * l.unitAmount).toFixed(2)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: "var(--muted)" }}
                    onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>
                Total (ex-VAT)
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                £{total.toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="inline-form">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="reference">Reference</label>
          <input id="reference" name="reference" defaultValue={defaultReference} />
        </div>
        {kindOptions && kindOptions.length > 0 && (
          <div className="field">
            <label htmlFor="kind">Role</label>
            <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">— untagged —</option>
              {kindOptions.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <button type="submit" className="btn" disabled={busy || lines.length === 0}>
          {busy ? "Creating…" : "Create DRAFT invoice in Xero"}
        </button>
      </div>
      <p className="muted small">
        Created as a draft — review, approve and send from Xero. A linked invoice row is added here
        automatically.
      </p>
    </form>
  );
}
