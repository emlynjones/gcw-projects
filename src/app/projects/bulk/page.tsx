import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { bulkCreateProjects, bulkUpdateProjects } from "@/app/actions";
import { stagesFor, stageLabel, LOST, projectTypeLabel } from "@/lib/status";
import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import BulkAddForm from "./BulkAddForm";

export const dynamic = "force-dynamic";

const monthInput = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : "");

export default async function BulkPage() {
  const [clients, conn, projects] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getConnection(),
    prisma.project.findMany({ include: { client: true }, orderBy: [{ archived: "asc" }, { updatedAt: "desc" }] }),
  ]);
  let xeroContacts: XeroContactLite[] = [];
  if (conn) {
    try {
      xeroContacts = await getUnlinkedXeroContacts();
    } catch {
      // Xero down — bulk add still works with local clients
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Bulk add / edit projects</h1>
        <Link href="/projects" className="btn btn-secondary">
          ← Back to projects
        </Link>
      </div>

      <div className="card">
        <h2>Add projects</h2>
        <p className="muted small">
          Fill in as many rows as you need — empty rows are skipped. Everything is optional except the name
          and can be edited later. Search the client field to filter local clients and Xero contacts.
        </p>
        <BulkAddForm initialClients={clients} xeroContacts={xeroContacts} action={bulkCreateProjects} />
      </div>

      <div className="card">
        <h2>Edit all projects</h2>
        <p className="muted small">Change anything and save once at the bottom.</p>
        <form action={bulkUpdateProjects}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Client</th>
                <th>Stage</th>
                <th style={{ width: 140 }}>Start</th>
                <th style={{ width: 140 }}>Est. end</th>
                <th style={{ width: 110 }}>Value £</th>
                <th>Archived</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="hidden" name="id" value={p.id} />
                    <input name={`title__${p.id}`} defaultValue={p.title} required />
                    <span className="muted small">{projectTypeLabel(p.type)}</span>
                  </td>
                  <td>
                    <select name={`clientId__${p.id}`} defaultValue={p.clientId}>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select name={`stage__${p.id}`} defaultValue={p.stage}>
                      {stagesFor(p.type).map((s) => (
                        <option key={s} value={s}>
                          {stageLabel(s)}
                        </option>
                      ))}
                      <option value={LOST}>{stageLabel(LOST)}</option>
                    </select>
                  </td>
                  <td>
                    <input name={`start__${p.id}`} type="month" defaultValue={monthInput(p.startDate)} />
                  </td>
                  <td>
                    <input name={`end__${p.id}`} type="month" defaultValue={monthInput(p.targetDate)} />
                  </td>
                  <td>
                    <input
                      name={`value__${p.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={p.totalValue}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      name={`archived__${p.id}`}
                      type="checkbox"
                      defaultChecked={p.archived}
                      style={{ width: "auto", height: 18 }}
                    />
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No projects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {projects.length > 0 && (
            <div className="mt">
              <button type="submit" className="btn">
                Save all changes
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
