"use client";

import { useState } from "react";
import { importOneXeroContact } from "@/app/xero-actions";
import { stagesFor, stageLabel } from "@/lib/status";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import type { XeroContactLite } from "@/lib/xero";

const ADD_ROWS = 10;
const DEFAULT_STAGE = "ONBOARDING";

export default function BulkAddForm({
  initialClients,
  xeroContacts,
  action,
}: {
  initialClients: ClientOption[];
  xeroContacts: XeroContactLite[];
  action: (formData: FormData) => void;
}) {
  const [clients, setClients] = useState(initialClients);
  const [selected, setSelected] = useState<string[]>(() => Array(ADD_ROWS).fill(""));

  function setAt(i: number, id: string) {
    setSelected((prev) => prev.map((v, idx) => (idx === i ? id : v)));
  }

  function handleImported(client: ClientOption) {
    setClients((prev) =>
      prev.some((c) => c.id === client.id) ? prev : [...prev, client].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  const stages = stagesFor("PROJECT");

  return (
    <form action={action}>
      <table>
        <thead>
          <tr>
            <th>Project name</th>
            <th style={{ width: 220 }}>Client</th>
            <th style={{ width: 170 }}>Stage</th>
            <th style={{ width: 140 }}>Start</th>
            <th style={{ width: 140 }}>Est. end</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ADD_ROWS }).map((_, i) => (
            <tr key={i}>
              <td>
                <input name="title" placeholder={i === 0 ? "Project name…" : ""} />
              </td>
              <td>
                <ClientPicker
                  clients={clients}
                  xeroContacts={xeroContacts}
                  importAction={importOneXeroContact}
                  value={selected[i]}
                  onChange={(id) => setAt(i, id)}
                  onImported={handleImported}
                />
                <input type="hidden" name="clientId" value={selected[i]} />
              </td>
              <td>
                <select name="stage" defaultValue={DEFAULT_STAGE}>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input name="start" type="month" />
              </td>
              <td>
                <input name="end" type="month" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt">
        <button type="submit" className="btn">
          Create projects
        </button>
      </div>
    </form>
  );
}
