"use client";

import { useMemo, useState, useTransition } from "react";
import type { XeroContactLite } from "@/lib/xero";

export type { XeroContactLite };

/** Search-as-you-type picker over Xero contacts; importing one creates/links a local client. */
export default function XeroClientSearch({
  contacts,
  importAction,
  onImported,
  placeholder = "Search Xero contacts by name or email…",
}: {
  contacts: XeroContactLite[];
  importAction: (contactId: string) => Promise<{ id: string; name: string }>;
  onImported: (client: { id: string; name: string }) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.contactName?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, contacts]);

  function pick(contactId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const client = await importAction(contactId);
        setQuery("");
        onImported(client);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      }
    });
  }

  return (
    <div className="xero-search">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={pending}
      />
      {error && <p className="error-msg">{error}</p>}
      {query.trim() && (
        <ul className="xero-search-results">
          {results.map((c) => (
            <li key={c.contactId}>
              <button type="button" onClick={() => pick(c.contactId)} disabled={pending}>
                <span>
                  <strong>{c.name}</strong>
                  {c.contactName ? ` · ${c.contactName}` : ""}
                  {c.email ? ` · ${c.email}` : ""}
                </span>
                {c.matchesExisting && <span className="badge badge-match">matches existing</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="muted small xero-search-empty">No matches</li>}
        </ul>
      )}
      {pending && <p className="muted small">Importing…</p>}
    </div>
  );
}
