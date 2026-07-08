import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { gbp, statusLabel, dateFmt } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await prisma.project.findMany({
    where: { status: { not: "ARCHIVED" } },
    include: { client: true, invoices: true },
    orderBy: { updatedAt: "desc" },
  });

  const pipeline = projects.filter((p) => ["ENQUIRY", "PROPOSAL_SENT"].includes(p.status));
  const active = projects.filter((p) => p.status === "ACTIVE");
  const inFlight = projects.filter((p) => ["ACTIVE", "INVOICED"].includes(p.status));

  const pipelineValue = pipeline.reduce((s, p) => s + p.totalValue, 0);
  const outstanding = inFlight.reduce(
    (s, p) => s + Math.max(0, p.totalValue - p.invoices.reduce((a, i) => a + i.amount, 0)),
    0
  );
  const invoicedUnpaid = projects
    .flatMap((p) => p.invoices)
    .filter((i) => !i.paid)
    .reduce((s, i) => s + i.amount, 0);

  const recent = projects.slice(0, 10);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link href="/projects/new" className="btn">
          + New project
        </Link>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Pipeline value</div>
          <div className="value">{gbp(pipelineValue)}</div>
          <div className="muted small">Enquiry + Proposal Sent</div>
        </div>
        <div className="stat">
          <div className="label">Left to invoice</div>
          <div className="value">{gbp(outstanding)}</div>
          <div className="muted small">Active + Invoiced projects</div>
        </div>
        <div className="stat">
          <div className="label">Invoiced, unpaid</div>
          <div className="value">{gbp(invoicedUnpaid)}</div>
          <div className="muted small">Across all invoices</div>
        </div>
        <div className="stat">
          <div className="label">Active projects</div>
          <div className="value">{active.length}</div>
          <div className="muted small">In delivery now</div>
        </div>
      </div>

      <h2>Recently updated</h2>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Status</th>
            <th className="num">Value (ex-VAT)</th>
            <th className="num">Invoiced</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((p) => {
            const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`}>{p.title}</Link>
                </td>
                <td>{p.client.name}</td>
                <td>
                  <span className={`badge badge-${p.status}`}>{statusLabel(p.status)}</span>
                </td>
                <td className="num">{gbp(p.totalValue)}</td>
                <td className="num">{gbp(invoiced)}</td>
                <td className="muted small">{dateFmt(p.updatedAt)}</td>
              </tr>
            );
          })}
          {recent.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No projects yet. <Link href="/projects/new">Create the first one</Link>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
