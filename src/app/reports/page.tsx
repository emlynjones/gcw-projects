import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  gbp,
  dateFmt,
  monthFmt,
  stageLabel,
  stageAction,
  lifecycleOf,
  PROJECT_STAGES,
  LOST,
} from "@/lib/status";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function ReportsPage() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  const projects = await prisma.project.findMany({
    where: { archived: false },
    include: {
      client: true,
      invoices: true,
      notes: { where: { timestamp: { gte: weekAgo } }, orderBy: { timestamp: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const withLife = projects.map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));
  const activeProjects = withLife.filter((p) => p.type === "PROJECT" && p.lifecycle === "ACTIVE");
  const adhoc = withLife.filter((p) => p.type === "ADHOC" && p.stage !== "INVOICED" && p.stage !== LOST);
  const enquiries = withLife.filter((p) => p.lifecycle === "ENQUIRY");

  // Went live in the last 7 days (completedDate set within the window)
  const wentLive = withLife.filter(
    (p) => p.completedDate && p.completedDate >= weekAgo && p.completedDate <= now
  );

  // Notes activity this week (across all non-archived projects)
  const activity = withLife
    .filter((p) => p.notes.length > 0)
    .map((p) => ({ project: p, notes: p.notes }));

  const outstanding = activeProjects.reduce(
    (s, p) => s + Math.max(0, p.totalValue - p.invoices.reduce((a, i) => a + i.amount, 0)),
    0
  );
  const invoicedUnpaid = withLife
    .flatMap((p) => p.invoices)
    .filter((i) => !i.paid)
    .reduce((s, i) => s + i.amount, 0);
  const pipeline = enquiries.reduce((s, p) => s + p.totalValue, 0);

  const byStage = PROJECT_STAGES.map((stage) => ({
    stage,
    items: activeProjects.filter((p) => p.stage === stage),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="report">
      <div className="page-head no-print">
        <h1>Weekly report</h1>
        <PrintButton />
      </div>

      <div className="print-only report-title">
        <h1>GCW Projects — Weekly Report</h1>
        <p className="muted">
          {dateFmt(weekAgo)} – {dateFmt(now)}
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Pipeline</div>
          <div className="value">{gbp(pipeline)}</div>
          <div className="muted small">{enquiries.length} enquiries</div>
        </div>
        <div className="stat">
          <div className="label">Left to invoice</div>
          <div className="value">{gbp(outstanding)}</div>
          <div className="muted small">{activeProjects.length} active projects</div>
        </div>
        <div className="stat">
          <div className="label">Invoiced, unpaid</div>
          <div className="value">{gbp(invoicedUnpaid)}</div>
        </div>
        <div className="stat">
          <div className="label">Ad-hoc ongoing</div>
          <div className="value">{adhoc.length}</div>
        </div>
      </div>

      {wentLive.length > 0 && (
        <div className="card">
          <h2>Went live this week</h2>
          <table>
            <tbody>
              {wentLive.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  </td>
                  <td className="muted">{p.client.name}</td>
                  <td className="muted small">
                    {p.startDate ? `${monthFmt(p.startDate)} → ` : ""}
                    {p.completedDate ? dateFmt(p.completedDate) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Active projects by stage</h2>
        {byStage.length === 0 && <p className="muted small">No active projects.</p>}
        {byStage.map(({ stage, items }) => (
          <div key={stage} className="stage-group">
            <h3>
              <span className="badge badge-stage">{stageLabel(stage)}</span>{" "}
              <span className="muted small">{items.length}</span>
            </h3>
            <table>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ width: "26%" }}>
                      <Link href={`/projects/${p.id}`}>{p.title}</Link>
                    </td>
                    <td className="muted" style={{ width: "20%" }}>
                      {p.client.name}
                    </td>
                    <td className="muted small" style={{ width: "18%" }}>
                      {p.targetDate ? `due ${monthFmt(p.targetDate)}` : ""}
                    </td>
                    <td className="muted small">{stageAction(p.type, p.stage).hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {adhoc.length > 0 && (
        <div className="card">
          <h2>Ad-hoc work ongoing</h2>
          <table>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Activity this week</h2>
        {activity.length === 0 && <p className="muted small">No notes logged in the last 7 days.</p>}
        {activity.map(({ project, notes }) => (
          <div key={project.id} className="activity-block">
            <h3>
              <Link href={`/projects/${project.id}`}>{project.title}</Link>{" "}
              <span className="muted small">· {project.client.name}</span>
            </h3>
            {notes.map((n) => (
              <div key={n.id} className="report-note">
                <span className="muted small">{dateFmt(n.timestamp)}</span> {n.body}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
