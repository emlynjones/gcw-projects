import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  gbp,
  dateFmt,
  monthFmt,
  dateTimeFmt,
  stageLabel,
  stageAction,
  lifecycleOf,
  PROJECT_STAGES,
  LOST,
} from "@/lib/status";
import { getAiStatus } from "@/lib/settings";
import { generateNextSteps, generateAllNextSteps } from "@/app/ai-actions";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const now = new Date();

  const projects = await prisma.project.findMany({
    where: { archived: false },
    include: {
      client: true,
      invoices: true,
      notes: { orderBy: { timestamp: "desc" }, take: 5 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const ai = await getAiStatus();
  const withLife = projects.map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));

  // Ad-hoc that still needs doing (anything not invoiced / lost), most urgent first.
  const adhocOrder = ["DOING", "DONE", "QUOTED", "ENQUIRY"];
  const adhoc = withLife
    .filter((p) => p.type === "ADHOC" && p.stage !== "INVOICED" && p.stage !== LOST)
    .sort((a, b) => adhocOrder.indexOf(a.stage) - adhocOrder.indexOf(b.stage));

  const activeProjects = withLife.filter((p) => p.type === "PROJECT" && p.stage !== LOST);
  const byStage = PROJECT_STAGES.map((stage) => ({
    stage,
    items: activeProjects.filter((p) => p.stage === stage),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="report">
      <div className="page-head no-print">
        <h1>Weekly report</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {ai.configured && (
            <form action={generateAllNextSteps}>
              <button type="submit" className="btn btn-secondary" title="Regenerate AI next steps for all active work">
                ✨ Refresh all AI next steps
              </button>
            </form>
          )}
          <PrintButton />
        </div>
      </div>

      <div className="print-only report-title">
        <h1>GCW Projects — Weekly Report</h1>
        <p className="muted">{dateFmt(now)}</p>
      </div>

      {/* Ad-hoc to-do list with hour budgets */}
      <div className="card">
        <h2>Ad-hoc — to do</h2>
        {adhoc.length === 0 ? (
          <p className="muted small">Nothing outstanding.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Client</th>
                <th>Stage</th>
                <th className="num">Hours (done / budget)</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {adhoc.map((p) => {
                const done = p.hoursDone ?? 0;
                const budget = p.hoursQuoted ?? 0;
                const over = budget > 0 && done > budget;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`}>{p.title}</Link>
                      {p.description && <div className="muted small tasks-preview">{p.description}</div>}
                    </td>
                    <td className="muted">{p.client.name}</td>
                    <td>
                      <span className="badge badge-stage">{stageLabel(p.stage)}</span>
                    </td>
                    <td className={`num ${over ? "paid-no" : ""}`}>
                      {done} / {budget || "—"}
                      {over ? " ⚠" : ""}
                    </td>
                    <td className="num">{gbp(p.totalValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Projects by stage — recent notes + next step + AI helper */}
      <div className="page-head no-print" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Projects by stage</h2>
        <Link href="/projects" className="small">
          all projects →
        </Link>
      </div>
      <h2 className="print-only">Projects by stage</h2>

      {byStage.length === 0 && <p className="muted">No active projects.</p>}

      {byStage.map(({ stage, items }) => (
        <div key={stage} className="stage-group">
          <h3>
            <span className="badge badge-stage">{stageLabel(stage)}</span>{" "}
            <span className="muted small">{items.length}</span>
          </h3>
          {items.map((p) => {
            const hint = stageAction(p.type, p.stage).hint;
            return (
              <div key={p.id} className="report-project">
                <div className="report-project-head">
                  <div>
                    <Link href={`/projects/${p.id}`} className="report-project-title">
                      {p.title}
                    </Link>{" "}
                    <span className="muted small">· {p.client.name}</span>
                    {p.targetDate && <span className="muted small"> · due {monthFmt(p.targetDate)}</span>}
                  </div>
                  {ai.configured && (
                    <form action={generateNextSteps.bind(null, p.id)} className="no-print">
                      <button type="submit" className="btn btn-ghost btn-sm" title="Refresh AI next steps">
                        ✨ {p.aiNextSteps ? "Refresh" : "Suggest"}
                      </button>
                    </form>
                  )}
                </div>

                <div className="report-project-grid">
                  <div className="report-notes">
                    <div className="report-subhead">Recent notes</div>
                    {p.notes.length === 0 ? (
                      <div className="muted small">No notes.</div>
                    ) : (
                      p.notes.map((n) => (
                        <div key={n.id} className="report-note">
                          <span className="muted small">{dateFmt(n.timestamp)}</span> {n.body}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="report-next">
                    <div className="report-subhead">Next step</div>
                    <div className="next-step-hint">{hint}</div>
                    {(ai.configured || p.aiNextSteps) && (
                      <div className="ai-next">
                        <div className="report-subhead">
                          AI suggestion
                          {p.aiNextStepsAt && (
                            <span className="muted small"> · {dateTimeFmt(p.aiNextStepsAt)}</span>
                          )}
                        </div>
                        {p.aiNextSteps ? (
                          <div style={{ whiteSpace: "pre-wrap" }}>{p.aiNextSteps}</div>
                        ) : (
                          <div className="muted small">
                            Not generated — use “Refresh all AI next steps” above or Suggest.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
