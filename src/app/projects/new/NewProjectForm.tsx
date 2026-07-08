"use client";

import { useState } from "react";
import Link from "next/link";
import { createProject } from "@/app/actions";
import { importOneXeroContact } from "@/app/xero-actions";
import { STATUSES, statusLabel, PROJECT_TYPES, projectTypeLabel } from "@/lib/status";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import type { XeroContactLite } from "@/lib/xero";

export default function NewProjectForm({
  initialClients,
  xeroConnected,
  xeroContacts,
}: {
  initialClients: ClientOption[];
  xeroConnected: boolean;
  xeroContacts: XeroContactLite[];
}) {
  const [clients, setClients] = useState(initialClients);
  const [selectedClientId, setSelectedClientId] = useState(initialClients[0]?.id ?? "");

  function handleImported(client: ClientOption) {
    setClients((prev) =>
      prev.some((c) => c.id === client.id) ? prev : [...prev, client].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  return (
    <div className="card">
      {clients.length === 0 && !xeroConnected ? (
        <p className="muted">
          No clients yet — <Link href="/clients/new">add a client first</Link>.
        </p>
      ) : (
        <form action={createProject} className="stack">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="type">Project type</label>
            <select id="type" name="type" defaultValue="WEBSITE">
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {projectTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field">
              <label>Client</label>
              <ClientPicker
                clients={clients}
                xeroContacts={xeroConnected ? xeroContacts : []}
                importAction={importOneXeroContact}
                value={selectedClientId}
                onChange={setSelectedClientId}
                onImported={handleImported}
              />
              <input type="hidden" name="clientId" value={selectedClientId} />
            </div>
            <div className="field">
              <label htmlFor="totalValue">Total value £ (ex-VAT)</label>
              <input id="totalValue" name="totalValue" type="number" step="0.01" min="0" defaultValue="0" />
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue="ENQUIRY">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="proposalUrl">Proposal URL</label>
            <input id="proposalUrl" name="proposalUrl" type="url" placeholder="https://…" />
          </div>
          <div>
            <button type="submit" className="btn" disabled={!selectedClientId}>
              Create project
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
