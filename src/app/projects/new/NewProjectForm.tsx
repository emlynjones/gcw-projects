"use client";

import { useState } from "react";
import Link from "next/link";
import { createProject } from "@/app/actions";
import { importOneXeroContact } from "@/app/xero-actions";
import { stagesFor, stageLabel, PROJECT_TYPES, projectTypeLabel, type ProjectType } from "@/lib/status";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import type { XeroContactLite } from "@/lib/xero";

export default function NewProjectForm({
  initialClients,
  xeroConnected,
  xeroContacts,
  initialType = "PROJECT",
}: {
  initialClients: ClientOption[];
  xeroConnected: boolean;
  xeroContacts: XeroContactLite[];
  initialType?: ProjectType;
}) {
  const [clients, setClients] = useState(initialClients);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [type, setType] = useState<ProjectType>(initialType);
  const isAdhoc = type === "ADHOC";

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
          <div className="type-toggle">
            {PROJECT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn ${type === t ? "" : "btn-secondary"}`}
                onClick={() => setType(t)}
              >
                {projectTypeLabel(t)}
              </button>
            ))}
            <input type="hidden" name="type" value={type} />
          </div>

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
            <label htmlFor="title">{isAdhoc ? "What's the job? (short description)" : "Title"}</label>
            <input
              id="title"
              name="title"
              required
              placeholder={isAdhoc ? "Fix contact form" : "New website for …"}
            />
          </div>

          {isAdhoc ? (
            <div className="row">
              <div className="field">
                <label htmlFor="totalValue">Amount quoted £ (ex-VAT)</label>
                <input id="totalValue" name="totalValue" type="number" step="0.01" min="0" defaultValue="0" />
              </div>
              <div className="field">
                <label htmlFor="hoursQuoted">Hours quoted</label>
                <input id="hoursQuoted" name="hoursQuoted" type="number" step="0.25" min="0" />
              </div>
              <div className="field">
                <label htmlFor="stage">Stage</label>
                <select id="stage" name="stage" defaultValue="QUOTED">
                  {stagesFor("ADHOC").map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {isAdhoc && (
            <div className="field">
              <label htmlFor="description">Details / tasks (optional)</label>
              <textarea
                id="description"
                name="description"
                rows={4}
                placeholder={"List the tasks, e.g.\n- Fix contact form\n- Update opening hours\n- Add new gallery"}
              />
            </div>
          )}

          {!isAdhoc && (
            <>
              <div className="row">
                <div className="field">
                  <label htmlFor="totalValue">Total value £ (ex-VAT)</label>
                  <input id="totalValue" name="totalValue" type="number" step="0.01" min="0" defaultValue="0" />
                </div>
                <div className="field">
                  <label htmlFor="stage">Stage</label>
                  <select id="stage" name="stage" defaultValue="ENQUIRY">
                    {stagesFor("PROJECT").map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="startDate">Start</label>
                  <input id="startDate" name="startDate" type="month" />
                </div>
                <div className="field">
                  <label htmlFor="targetDate">Expected finish</label>
                  <input id="targetDate" name="targetDate" type="month" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="description">Description (optional)</label>
                <textarea id="description" name="description" rows={2} placeholder="Short scope / overview…" />
              </div>
              <div className="field">
                <label htmlFor="proposalUrl">Proposal URL</label>
                <input id="proposalUrl" name="proposalUrl" type="url" placeholder="https://…" />
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Standard hosting &amp; a domain will be added automatically — edit or remove them on the project
                page.
              </p>
            </>
          )}

          <div>
            <button type="submit" className="btn" disabled={!selectedClientId}>
              {isAdhoc ? "Create ad-hoc job" : "Create project"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
