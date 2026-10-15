"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import { importOneXeroContact } from "@/app/xero-actions";
import { setWebsiteClient, assignWebsitesToClient } from "@/app/website-actions";
import { serviceKindLabel } from "@/lib/recurring";
import { gbp } from "@/lib/status";
import type { XeroContactLite } from "@/lib/xero";

export type WebsiteRow = {
  id: string;
  name: string;
  url: string | null;
  clientId: string | null;
  clientName: string | null;
  domains: string[];
  serviceCount: number;
  kinds: Record<string, number>;
  annualSell: number;
  annualCost: number;
  renewalDisplay: string;
  unbilled: number;
};

export default function WebsitesTable({
  rows,
  clients: initialClients,
  xeroContacts,
}: {
  rows: WebsiteRow[];
  clients: ClientOption[];
  xeroContacts: XeroContactLite[];
}) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState(initialClients);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkClient, setBulkClient] = useState("");
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.clientName?.toLowerCase().includes(q) ||
        r.domains.some((d) => d.includes(q))
    );
  }, [rows, q]);

  function addClient(client: ClientOption) {
    setClients((prev) =>
      prev.some((c) => c.id === client.id)
        ? prev
        : [...prev, client].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  function assignRow(websiteId: string, clientId: string) {
    startTransition(async () => {
      await setWebsiteClient(websiteId, clientId || null);
      setEditing(null);
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  return (
    <form action={assignWebsitesToClient}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search websites, domains or clients…"
        className="mt"
        style={{ maxWidth: 320 }}
      />

      <table className="mt">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={() =>
                  setSelected(allShownSelected ? new Set() : new Set(filtered.map((r) => r.id)))
                }
                style={{ width: "auto" }}
                aria-label="Select all shown"
              />
            </th>
            <th>Website</th>
            <th style={{ width: 260 }}>Client</th>
            <th>Services</th>
            <th>Next renewal</th>
            <th className="num">Cost</th>
            <th className="num">Sell</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  name="websiteId"
                  value={r.id}
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  style={{ width: "auto" }}
                  aria-label={`Select ${r.name}`}
                />
              </td>
              <td>
                <Link href={`/websites/${r.id}`}>{r.name}</Link>
                {r.domains.length > 1 && (
                  <div className="muted small">
                    +{r.domains.length - 1} more domain{r.domains.length > 2 ? "s" : ""}
                  </div>
                )}
              </td>
              <td>
                {editing === r.id ? (
                  <ClientPicker
                    clients={clients}
                    xeroContacts={xeroContacts}
                    importAction={importOneXeroContact}
                    value={r.clientId ?? ""}
                    onChange={(id) => assignRow(r.id, id)}
                    onImported={addClient}
                  />
                ) : (
                  <button
                    type="button"
                    className={r.clientId ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
                    onClick={() => setEditing(r.id)}
                    disabled={pending}
                  >
                    {r.clientName ?? "Assign client"}
                  </button>
                )}
              </td>
              <td className="muted small">
                {r.serviceCount === 0
                  ? "—"
                  : Object.entries(r.kinds)
                      .map(([kind, n]) => `${n} ${serviceKindLabel(kind).toLowerCase()}`)
                      .join(", ")}
                {r.unbilled > 0 && <span className="badge ml-1 paid-no">{r.unbilled} not billed</span>}
              </td>
              <td className="muted small">{r.renewalDisplay || "—"}</td>
              <td className="num">{gbp(r.annualCost)}</td>
              <td className="num">{gbp(r.annualSell)}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                {q ? `No matches for "${query.trim()}".` : "Nothing here."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected.size > 0 && (
        <div className="card mt">
          <h2>Assign {selected.size} selected website(s) to a client</h2>
          <p className="muted small">
            Their services move across too — except any already assigned to a different client, which
            are left alone.
          </p>
          <ClientPicker
            clients={clients}
            xeroContacts={xeroContacts}
            importAction={importOneXeroContact}
            value={bulkClient}
            onChange={setBulkClient}
            onImported={addClient}
          />
          <input type="hidden" name="clientId" value={bulkClient} />
          <div className="mt">
            <button type="submit" className="btn" disabled={!bulkClient}>
              Assign selected
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
