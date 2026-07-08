import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateClient, deleteClient } from "@/app/actions";
import { gbp, statusLabel, dateFmt } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: { projects: { include: { invoices: true }, orderBy: { updatedAt: "desc" } } },
  });
  if (!client) notFound();

  return (
    <>
      <div className="page-head">
        <h1>{client.name}</h1>
        <Link href="/projects/new" className="btn btn-secondary">
          + New project
        </Link>
      </div>

      <div className="card">
        <h2>Details</h2>
        <form action={updateClient.bind(null, client.id)} className="stack">
          <div className="field">
            <label htmlFor="name">Company / organisation name</label>
            <input id="name" name="name" defaultValue={client.name} required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="contactName">Contact name</label>
              <input id="contactName" name="contactName" defaultValue={client.contactName ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" defaultValue={client.email ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={client.phone ?? ""} />
            </div>
          </div>
          <div>
            <button type="submit" className="btn">
              Save changes
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Projects</h2>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th className="num">Value (ex-VAT)</th>
              <th className="num">Invoiced</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {client.projects.map((p) => {
              const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  </td>
                  <td>
                    <span className={`badge badge-${p.status}`}>{statusLabel(p.status)}</span>
                  </td>
                  <td className="num">{gbp(p.totalValue)}</td>
                  <td className="num">{gbp(invoiced)}</td>
                  <td className="muted small">{dateFmt(p.updatedAt)}</td>
                </tr>
              );
            })}
            {client.projects.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No projects for this client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {client.projects.length === 0 && (
        <div className="card">
          <h2>Danger zone</h2>
          <form action={deleteClient.bind(null, client.id)}>
            <button type="submit" className="btn btn-danger">
              Delete client
            </button>
          </form>
        </div>
      )}
    </>
  );
}
