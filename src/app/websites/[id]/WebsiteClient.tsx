"use client";

import { useState, useTransition } from "react";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import { importOneXeroContact } from "@/app/xero-actions";
import { setWebsiteClient } from "@/app/website-actions";
import type { XeroContactLite } from "@/lib/xero";

/**
 * The website's client. Assigning here pulls the website's unassigned services
 * across too, which is the whole point — a website with a client is billable.
 */
export default function WebsiteClient({
  websiteId,
  clientId,
  clientName,
  clients: initialClients,
  xeroContacts,
}: {
  websiteId: string;
  clientId: string | null;
  clientName: string | null;
  clients: ClientOption[];
  xeroContacts: XeroContactLite[];
}) {
  const [clients, setClients] = useState(initialClients);
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(id: string) {
    startTransition(async () => {
      const count = await setWebsiteClient(websiteId, id || null);
      setMoved(count);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div>
        <span className="muted small">Client: </span>
        {clientName ? <strong>{clientName}</strong> : <span className="paid-no">Not assigned</span>}
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-1"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          {clientName ? "Change" : "Assign"}
        </button>
        {moved !== null && moved > 0 && (
          <span className="muted small ml-1">{moved} service(s) moved across.</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 380 }}>
      <ClientPicker
        clients={clients}
        xeroContacts={xeroContacts}
        importAction={importOneXeroContact}
        value={clientId ?? ""}
        onChange={pick}
        onImported={(c) =>
          setClients((prev) =>
            prev.some((x) => x.id === c.id)
              ? prev
              : [...prev, c].sort((a, b) => a.name.localeCompare(b.name))
          )
        }
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {clientId && (
        <button type="button" className="btn btn-ghost btn-sm ml-1" onClick={() => pick("")}>
          Remove client
        </button>
      )}
    </div>
  );
}
