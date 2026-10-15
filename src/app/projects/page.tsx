import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  lifecycleOf,
  lifecycleLabel,
  isLifecycle,
  isProjectType,
  LIFECYCLES,
  isFinished,
  stageRank,
  dueOrder,
  gbp,
} from "@/lib/status";
import ProjectsTable from "./ProjectsTable";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ life?: string; type?: string; client?: string }>;
}) {
  const { life, type, client: clientFilter } = await searchParams;
  const lifeFilter = life && isLifecycle(life) ? life : undefined;
  const typeFilter = type && isProjectType(type) ? type : undefined;

  const [all, filteredClient] = await Promise.all([
    prisma.project.findMany({
      where: {
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(clientFilter ? { clientId: clientFilter } : {}),
      },
      include: { client: true, invoices: true },
      orderBy: { updatedAt: "desc" },
    }),
    clientFilter
      ? prisma.client.findUnique({ where: { id: clientFilter }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const withLife = all.map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));

  /**
   * Ad-hoc sorts by when it needs doing; projects by how near delivery they
   * are, so a site in GO_LIVE sits above a fresh enquiry. Anything without a
   * stage to rank falls back to most-recently-touched.
   */
  const inWorkOrder = <T extends (typeof withLife)[number]>(rows: T[]) =>
    [...rows].sort((a, b) => {
      if (a.type === "ADHOC" && b.type === "ADHOC") return dueOrder(a) - dueOrder(b);
      const rank = stageRank(b) - stageRank(a);
      return rank !== 0 ? rank : b.updatedAt.getTime() - a.updatedAt.getTime();
    });

  // Default view hides finished, archived and lost work — the list answers
  // "what needs attention", and completed jobs crowd that out. They stay one
  // click away in the archive below. Explicit filters show exactly their
  // bucket; scoped to one client, show everything they have, because the count
  // that linked here includes finished work and a list that silently omits it
  // looks broken.
  const current = lifeFilter
    ? withLife.filter((p) => p.lifecycle === lifeFilter)
    : clientFilter
      ? withLife
      : withLife.filter((p) => !isFinished(p) && p.lifecycle !== "LOST");
  const projects = inWorkOrder(current);

  // Only offered on the default view — with a filter applied, the filter is
  // already saying what to show.
  const archived =
    lifeFilter || clientFilter
      ? []
      : inWorkOrder(withLife.filter((p) => isFinished(p) || p.lifecycle === "LOST"));
  const archiveValue = archived.reduce((n, p) => n + p.totalValue, 0);

  const qs = (params: Record<string, string | undefined>) => {
    const merged = { life: lifeFilter, type: typeFilter, client: clientFilter, ...params };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    const str = s.toString();
    return str ? `?${str}` : "";
  };

  return (
    <>
      <div className="page-head">
        <h1>
          {typeFilter === "ADHOC" ? "Ad-hoc work" : typeFilter === "PROJECT" ? "Projects" : "Work"}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/projects/new?type=ADHOC" className="btn btn-secondary">
            + Ad-hoc quote
          </Link>
          <Link href="/projects/new?type=PROJECT" className="btn">
            + New project
          </Link>
        </div>
      </div>

      {filteredClient && (
        <p className="muted small">
          Showing projects for <strong>{filteredClient.name}</strong> ·{" "}
          <Link href="/projects">show all projects</Link>
        </p>
      )}

      <div className="filters">
        <Link href={`/projects${qs({ life: undefined })}`} className={!lifeFilter ? "active" : ""}>
          {clientFilter ? "All" : "Current"}
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

      <ProjectsTable projects={projects} />

      {archived.length > 0 && (
        <details className="card archive">
          <summary>
            Archive — {archived.length} finished or lost{" "}
            <span className="muted small">({gbp(archiveValue)} of work)</span>
          </summary>
          <div className="mt">
            <ProjectsTable projects={archived} />
          </div>
        </details>
      )}

      <p className="muted small mt" style={{ textAlign: "right" }}>
        <Link href="/projects/bulk">Bulk add / edit…</Link>
      </p>
    </>
  );
}
