"use client";

import { useMemo, useState } from "react";
import { saveServiceItemMap, saveRecurringItemMap } from "@/app/xero-item-actions";

export type MapItem = {
  code: string;
  name: string;
  unitPrice: number | null;
  accountCode: string | null;
};

export type MapRow = {
  id: string;
  name: string;
  group: string;
  detail: string;
  price: number;
  code: string | null;
};

/**
 * Map services to Xero products, entirely offline.
 *
 * Everything here comes from the local cache, so changing forty dropdowns costs
 * nothing and works with Xero disconnected. The whole set saves in one submit
 * rather than a call per row — mapping is a sitting-down job, not a series of
 * individual decisions each worth a round trip.
 */
export default function MapForm({
  mode,
  items,
  rows,
  defaultsAction,
}: {
  mode: "service" | "recurring";
  items: MapItem[];
  rows: MapRow[];
  defaultsAction?: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const prefix = mode === "recurring" ? "rec:" : "svc:";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (unmappedOnly && r.code) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q)
      );
    });
  }, [rows, search, unmappedOnly]);

  const unmapped = rows.filter((r) => !r.code).length;

  // Grouped so a long list reads as sections rather than four hundred rows.
  const grouped = useMemo(() => {
    const m = new Map<string, MapRow[]>();
    for (const r of shown) {
      const bucket = m.get(r.group);
      if (bucket) bucket.push(r);
      else m.set(r.group, [r]);
    }
    return [...m.entries()];
  }, [shown]);

  return (
    <form action={mode === "recurring" ? saveRecurringItemMap : saveServiceItemMap}>
      <div className="card">
        <div className="filters">
          <a
            href="#"
            className={!unmappedOnly ? "active" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setUnmappedOnly(false);
            }}
          >
            All ({rows.length})
          </a>
          <a
            href="#"
            className={unmappedOnly ? "active" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setUnmappedOnly(true);
            }}
          >
            Not mapped ({unmapped})
          </a>
          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: "auto", maxWidth: 240 }}
          />
        </div>

        {grouped.map(([group, groupRows]) => (
          <div key={group} className="mt">
            <h3 className="muted small">{group}</h3>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="num">Price</th>
                  <th style={{ width: "38%" }}>Bills in Xero as</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      <div className="muted small">{r.detail}</div>
                    </td>
                    <td className="num">£{r.price.toFixed(2)}</td>
                    <td>
                      <select name={`${prefix}${r.id}`} defaultValue={r.code ?? ""}>
                        <option value="">— none —</option>
                        {items.map((i) => (
                          <option key={i.code} value={i.code}>
                            {i.code} · {i.name.slice(0, 40)}
                            {i.unitPrice ? ` (£${i.unitPrice.toFixed(2)})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {shown.length === 0 && <p className="muted">Nothing matches that filter.</p>}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <button type="submit" className="btn">
            Save mappings
          </button>
          <span className="muted small">
            Saves every row on this tab, including ones hidden by the filter.
          </span>
        </div>
      </div>

      {defaultsAction && (
        <div className="card">
          <h2>Standard codes</h2>
          <p className="muted">
            Fills only what has no product yet — domains as <code>DOM</code>, hosting as{" "}
            <code>HOST-STD</code>, Office 365 as <code>O365-BE</code>. Care plans are left alone:
            there are six plan products across two languages and nothing in a service label says
            which one a client is on.
          </p>
          <button type="submit" className="btn btn-secondary" formAction={defaultsAction}>
            Apply standard codes to unmapped
          </button>
        </div>
      )}
    </form>
  );
}
