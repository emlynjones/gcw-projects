"use client";

import { useMemo, useState, useTransition } from "react";
import type { XeroContactLite } from "@/lib/xero";

export type ClientOption = { id: string; name: string };

/**
 * Combined client picker for the New Project form: typing searches local
 * clients and unlinked Xero contacts together. Picking a local client just
 * selects it; picking a Xero contact imports/links it in the background
 * first, then selects it.
 */
export default function ClientPicker({
  clients,
  xeroContacts,
  importAction,
  value,
  onChange,
  onImported,
}: {
  clients: ClientOption[];
  xeroContacts: XeroContactLite[];
  importAction: (contactId: string) => Promise<ClientOption>;
  value: string;
  onChange: (clientId: string) => void;
  onImported: (client: ClientOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();

  const filteredClients = useMemo(() => {
    if (!q) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, q]);

  const filteredXero = useMemo(() => {
    if (!q) return [];
    return xeroContacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.contactName?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [xeroContacts, q]);

  const selected = clients.find((c) => c.id === value);

  function pickLocal(client: ClientOption) {
    onChange(client.id);
    setQuery("");
  }

  function pickXero(contactId: string) {
    setError(null);
    setImportingId(contactId);
    startTransition(async () => {
      try {
        const client = await importAction(contactId);
        onImported(client);
        onChange(client.id);
        setQuery("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      } finally {
        setImportingId(null);
      }
    });
  }

  return (
    <div className="client-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clients…"
      />
      {selected && <p className="muted small">Selected: {selected.name}</p>}
      {error && <p className="error-msg">{error}</p>}
      {q && (
        <ul className="xero-search-results">
          {filteredClients.map((c) => (
            <li key={c.id}>
              <button type="button" className={c.id === value ? "selected" : ""} onClick={() => pickLocal(c)}>
                <span>{c.name}</span>
                {c.id === value && <span className="badge badge-match">selected</span>}
              </button>
            </li>
          ))}
          {filteredXero.map((c) => (
            <li key={c.contactId}>
              <button type="button" onClick={() => pickXero(c.contactId)} disabled={pending}>
                <span>
                  <strong>{c.name}</strong>
                  {c.contactName ? ` · ${c.contactName}` : ""}
                  {c.email ? ` · ${c.email}` : ""}
                </span>
                <span className="badge badge-xero-source">
                  {importingId === c.contactId ? "Importing…" : "From Xero"}
                </span>
              </button>
            </li>
          ))}
          {filteredClients.length === 0 && filteredXero.length === 0 && (
            <li className="muted small xero-search-empty">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
