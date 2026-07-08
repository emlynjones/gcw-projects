import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  gbp,
  monthFmt,
  dateFmt,
  stageLabel,
  lifecycleOf,
  stageAction,
  PROJECT_STAGES,
  LOST,
} from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await prisma.project.findMany({
    where: { archived: false },
    include: { client: true, invoices: true },
    orderBy: { updatedAt: "desc" },
  });

  const withLife = projects.map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));

  const pipelineValue = withLife
    .filter((p) => p.lifecycle === "ENQUIRY")
    .reduce((s, p) => s + p.totalValue, 0);
  const active = withLife.filter((p) => p.lifecycle === "ACTIVE");
  const outstanding = active.reduce(
    (s, p) => s + Math.max(0, p.totalValue - p.invoices.reduce((a, i) => a + i.amount, 0)),
    0
  );
  const invoicedUnpaid = projects
    .flatMap((p) => p.invoices)
    .filter((i) => !i.paid)
    .reduce((s, i) => s + i.amount, 0);

  // Ongoing ad-hoc: anything not yet invoiced (and not lost)
  const adhoc = withLife.filter((p) => p.type === "ADHOC" && p.stage !== "INVOICED" && p.stage !== LOST);

  // Full projects grouped by stage, in track order
  const fulls = withLife.filter((p) => p.type === "PROJECT" && p.stage !== LOST);
  const groups = PROJECT_STAGES.map((stage) => ({
    stage,
    items: fulls.filter((p) => p.stage === stage),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/projects/new?type=ADHOC" className="btn">
            + Ad-hoc quote
          </Link>
          <Link href="/projects/new?type=PROJECT" className="btn">
            + New project
          </Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Pipeline value</div>
          <div className="value">{gbp(pipelineValue)}</div>
          <div className="muted small">Enquiries + quoted</div>
        </div>
        <div className="stat">
          <div className="label">Left to invoice</div>
          <div className="value">{gbp(outstanding)}</div>
          <div className="muted small">Active work</div>
        </div>
        <div className="stat">
          <div className="label">Invoiced, unpaid</div>
          <div className="value">{gbp(invoicedUnpaid)}</div>
          <div className="muted small">Across all invoices</div>
        </div>
        <div className="stat">
          <div className="label">Active</div>
          <div className="value">
            {active.filter((p) => p.type === "PROJECT").length} + {adhoc.filter((p) => p.lifecycle === "ACTIVE").length}
          </div>
          <div className="muted small">Projects + ad-hoc in flight</div>
        </div>
      </div>

      {/* Compact ongoing ad-hoc list */}
      <div className="card">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Ad-hoc work</h2>
          <Link href="/projects?type=ADHOC" className="small">
            all ad-hoc →
          </Link>
        </div>
        {adhoc.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing ongoing.
          </p>
        ) : (
          <table className="compact">
            <tbody>
              {adhoc.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  </td>
                  <td className="muted">{p.client.name}</td>
                  <td>
                    <span className="badge badge-stage">{stageLabel(p.stage)}</span>
                  </td>
                  <td className="num">{gbp(p.totalValue)}</td>
                  <td className="num muted small">
                    {p.hoursQuoted ?? "—"}h quoted · {p.hoursDone ?? "—"}h done
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Projects by stage */}
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Projects by stage</h2>
        <Link href="/projects" className="small">
          all projects →
        </Link>
      </div>
      {groups.length === 0 && (
        <p className="muted">
          No projects yet. <Link href="/projects/new">Create the first one</Link>.
        </p>
      )}
      {groups.map(({ stage, items }) => (
        <div key={stage} className="stage-group">
          <h3>
            <span className="badge badge-stage">{stageLabel(stage)}</span>
            <span className="muted small"> {items.length}</span>
          </h3>
          <table>
            <tbody>
              {items.map((p) => {
                const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
                const hint = stageAction(p.type, p.stage).hint;
                return (
                  <tr key={p.id}>
                    <td style={{ width: "28%" }}>
                      <Link href={`/projects/${p.id}`}>{p.title}</Link>
                    </td>
                    <td className="muted" style={{ width: "18%" }}>
                      {p.client.name}
                    </td>
                    <td className="muted small" style={{ width: "22%" }}>
                      {p.startDate ? monthFmt(p.startDate) : "?"} → {p.targetDate ? monthFmt(p.targetDate) : "?"}
                    </td>
                    <td className="num" style={{ width: "10%" }}>
                      {gbp(p.totalValue)}
                    </td>
                    <td className="num muted small" style={{ width: "12%" }}>
                      {gbp(invoiced)} invoiced
                    </td>
                    <td className="muted small">{hint}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <p className="muted small mt">
        Recently updated:{" "}
        {withLife.slice(0, 5).map((p, i) => (
          <span key={p.id}>
            {i > 0 && " · "}
            <Link href={`/projects/${p.id}`}>{p.title}</Link> <span className="muted">({dateFmt(p.updatedAt)})</span>
          </span>
        ))}
      </p>
    </>
  );
}
