import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  gbp,
  monthFmt,
  dateFmt,
  stageLabel,
  lifecycleOf,
  lifecycleLabel,
  isLifecycle,
  isProjectType,
  projectTypeLabel,
  LIFECYCLES,
} from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ life?: string; type?: string }>;
}) {
  const { life, type } = await searchParams;
  const lifeFilter = life && isLifecycle(life) ? life : undefined;
  const typeFilter = type && isProjectType(type) ? type : undefined;

  const all = await prisma.project.findMany({
    where: typeFilter ? { type: typeFilter } : undefined,
    include: { client: true, invoices: true },
    orderBy: { updatedAt: "desc" },
  });

  const withLife = all.map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));
  // Default view hides archived + lost; explicit filters show exactly that bucket
  const projects = lifeFilter
    ? withLife.filter((p) => p.lifecycle === lifeFilter)
    : withLife.filter((p) => p.lifecycle !== "ARCHIVED" && p.lifecycle !== "LOST");

  const qs = (params: Record<string, string | undefined>) => {
    const merged = { life: lifeFilter, type: typeFilter, ...params };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    const str = s.toString();
    return str ? `?${str}` : "";
  };

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/projects/new?type=ADHOC" className="btn btn-secondary">
            + Ad-hoc quote
          </Link>
          <Link href="/projects/new?type=PROJECT" className="btn">
            + New project
          </Link>
        </div>
      </div>

      <div className="filters">
        <Link href={`/projects${qs({ life: undefined })}`} className={!lifeFilter ? "active" : ""}>
          Current
        </Link>
        {LIFECYCLES.map((l) => (
          <Link
            key={l}
            href={`/projects${qs({ life: l })}`}
            className={lifeFilter === l ? "active" : ""}
          >
            {lifecycleLabel(l)}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <Link href={`/projects${qs({ type: undefined })}`} className={!typeFilter ? "active" : ""}>
          All types
        </Link>
        <Link href={`/projects${qs({ type: "PROJECT" })}`} className={typeFilter === "PROJECT" ? "active" : ""}>
          Projects
        </Link>
        <Link href={`/projects${qs({ type: "ADHOC" })}`} className={typeFilter === "ADHOC" ? "active" : ""}>
          Ad-hoc
        </Link>
      </div>

      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Stage</th>
            <th>Dates</th>
            <th className="num">Value (ex-VAT)</th>
            <th className="num">Invoiced</th>
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
                  <span className={`badge ${p.stage === "LOST" ? "badge-life-LOST" : "badge-stage"}`}>
                    {stageLabel(p.stage)}
                  </span>
                </td>
                <td className="muted small">
                  {p.startDate || p.targetDate
                    ? `${p.startDate ? monthFmt(p.startDate) : "?"} → ${p.targetDate ? monthFmt(p.targetDate) : "?"}`
                    : "—"}
                </td>
                <td className="num">{gbp(p.totalValue)}</td>
                <td className="num">{gbp(invoiced)}</td>
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

      <p className="muted small mt" style={{ textAlign: "right" }}>
        <Link href="/projects/bulk">Bulk add / edit…</Link>
      </p>
    </>
  );
}
