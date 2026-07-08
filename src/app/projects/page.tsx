import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STATUSES, statusLabel, gbp, isStatus, dateFmt, projectTypeLabel } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status && isStatus(status) ? status : undefined;

  const projects = await prisma.project.findMany({
    where: filter ? { status: filter } : { status: { not: "ARCHIVED" } },
    include: { client: true, invoices: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <Link href="/projects/new" className="btn">
          + New project
        </Link>
      </div>

      <div className="filters">
        <Link href="/projects" className={!filter ? "active" : ""}>
          All (excl. archived)
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/projects?status=${s}`} className={filter === s ? "active" : ""}>
            {statusLabel(s)}
          </Link>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Status</th>
            <th className="num">Value (ex-VAT)</th>
            <th className="num">Invoiced</th>
            <th className="num">Left</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  {p.type === "ADHOC" && (
                    <span className="badge badge-type ml-1">{projectTypeLabel(p.type)}</span>
                  )}
                </td>
                <td>{p.client.name}</td>
                <td>
                  <span className={`badge badge-${p.status}`}>{statusLabel(p.status)}</span>
                </td>
                <td className="num">{gbp(p.totalValue)}</td>
                <td className="num">{gbp(invoiced)}</td>
                <td className="num">{gbp(p.totalValue - invoiced)}</td>
                <td className="muted small">{dateFmt(p.updatedAt)}</td>
              </tr>
            );
          })}
          {projects.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Nothing here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
