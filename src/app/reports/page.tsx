import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dateFmt, monthFmt, stageAction, stageLabel, stagesFor, canMarkLost, LOST } from "@/lib/status";
import { addDays, monday, PLANNED_PERIODS, todayLondon } from "@/modules/work/domain";
import { getAiStatus } from "@/lib/settings";
import { generateNextSteps, generateAllNextSteps } from "@/app/ai-actions";
import PrintButton from "./PrintButton";
import { QuickNote, StageSelect } from "./ReportControls";

export const dynamic = "force-dynamic";
const priorityRank = (value: string) => ["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(value);

export default async function ReportsPage() {
  const today = todayLondon();
  const week = monday(today);
  const weekEnd = addDays(week, 7);
  const recentSince = new Date(`${addDays(today, -14)}T00:00:00Z`);
  const [projects, people, ai] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false, stage: { not: LOST } },
      include: {
        client: true,
        notes: { orderBy: { timestamp: "desc" }, take: 2 },
        tasks: {
          include: {
            dependencies: true,
            processItem: { include: { application: { include: { revision: { select: { name: true } } } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["admin", "staff"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getAiStatus(),
  ]);
  const allTasks = projects.flatMap((project) => project.tasks.map((task) => ({ ...task, project })));
  const scheduled = allTasks.filter((task) => task.status !== "DONE" && task.plannedDate && task.plannedDate >= week && task.plannedDate < weekEnd);
  const options = (project: { type: string; stage: string }) => [
    ...stagesFor(project.type),
    ...(canMarkLost(project.stage) ? [LOST] : []),
  ].map((value) => ({ value, label: stageLabel(value) }));

  return <div className="report">
    <div className="page-head no-print">
      <div><h1>Weekly planning report</h1><p className="muted">Week beginning {dateFmt(new Date(`${week}T12:00:00Z`))}</p></div>
      <div className="action-row">
        <Link href="/work?view=planner" className="btn btn-secondary">Edit weekly plan</Link>
        {ai.configured && <form action={generateAllNextSteps}><button className="btn btn-secondary">✨ Refresh suggestions</button></form>}
        <PrintButton />
      </div>
    </div>
    <div className="print-only report-title"><h1>GCW — Weekly plan</h1><p>Week beginning {dateFmt(new Date(`${week}T12:00:00Z`))}</p></div>

    <section className="card weekly-plan">
      <h2>This week</h2>
      <p className="muted small no-print">Project and ad-hoc tasks are combined here. Assign AM or PM in the Weekly Planner.</p>
      <div className="weekly-plan-days">
        {Array.from({ length: 5 }, (_, index) => addDays(week, index)).map((day) => <section key={day} className="weekly-plan-day">
          <h3>{new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
          {[...PLANNED_PERIODS, "UNALLOCATED" as const].map((period) => {
            const items = scheduled.filter((task) => task.plannedDate === day && (period === "UNALLOCATED" ? !task.plannedPeriod : task.plannedPeriod === period));
            if (period === "UNALLOCATED" && !items.length) return null;
            return <div className="weekly-plan-period" key={period}>
              <strong>{period === "UNALLOCATED" ? "Period needed" : period}</strong>
              {items.length ? items.map((task) => <div className="weekly-plan-item" key={task.id}>
                <span>☐ {task.title}</span>
                <span className="muted small">{task.project.type === "ADHOC" ? "Ad hoc · " : ""}{task.project.title}{task.assigneeId ? ` · ${people.find((person) => person.id === task.assigneeId)?.name ?? "Assigned"}` : " · Unassigned"}</span>
              </div>) : <div className="weekly-plan-space">Available</div>}
            </div>;
          })}
        </section>)}
      </div>
    </section>

    <div className="report-section-head"><h2>Projects</h2><span className="muted small">Where we are, what moves next, and what is needed</span></div>
    {projects.filter((project) => project.type === "PROJECT").map((project) => {
      const doneIds = new Set(project.tasks.filter((task) => task.status === "DONE").map((task) => task.id));
      const outstanding = project.tasks.filter((task) => task.status !== "DONE");
      const ready = outstanding.filter((task) => task.dependencies.every((edge) => doneIds.has(edge.prerequisiteId))).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
      const blocked = outstanding.filter((task) => task.status === "BLOCKED" || task.dependencies.some((edge) => !doneIds.has(edge.prerequisiteId)));
      const recentlyDone = project.tasks.filter((task) => task.completedAt && task.completedAt >= recentSince);
      const processNames = [...new Set(outstanding.flatMap((task) => task.processItem ? [task.processItem.application.revision.name] : []))];
      const missing = ready.filter((task) => !task.assigneeId || task.estimatedHours === null);
      return <article key={project.id} className="report-project">
        <div className="report-project-head">
          <div><Link href={`/projects/${project.id}`} className="report-project-title">{project.title}</Link><span className="muted small"> · {project.client.name}</span>{project.targetDate && <span className="muted small"> · due {monthFmt(project.targetDate)}</span>}</div>
          <span className="print-only badge badge-stage">{stageLabel(project.stage)}</span>
          <StageSelect projectId={project.id} stage={project.stage} options={options(project)} />
        </div>
        <div className="report-position"><strong>{stageLabel(project.stage)}</strong> — {stageAction(project.type, project.stage).hint}{processNames.length > 0 && <span className="muted"> · Active process: {processNames.join(", ")}</span>}</div>
        <div className="report-action-grid">
          <section><div className="report-subhead">Where are we?</div>
            {recentlyDone.slice(-3).map((task) => <div key={task.id}>✓ {task.title}</div>)}
            {project.notes.map((note) => <div key={note.id} className="report-note"><span className="muted small">{dateFmt(note.timestamp)}</span> {note.body}</div>)}
            {!recentlyDone.length && !project.notes.length && <div className="muted small">No recent update recorded.</div>}
          </section>
          <section><div className="report-subhead">What’s next?</div>
            {ready.slice(0, 4).map((task) => <div key={task.id}>☐ {task.title}{task.processItem && <span className="muted small"> · process</span>}</div>)}
            {!ready.length && <div className="muted small">No ready task — review blockers or add the next action.</div>}
          </section>
          <section><div className="report-subhead">What do we need?</div>
            {blocked.slice(0, 3).map((task) => <div key={task.id}>△ {task.title}</div>)}
            {missing.slice(0, 2).map((task) => <div key={`missing-${task.id}`} className="muted small">{task.title}: {!task.assigneeId ? "assignee" : ""}{!task.assigneeId && task.estimatedHours === null ? " and " : ""}{task.estimatedHours === null ? "estimate" : ""} needed</div>)}
            {!blocked.length && !missing.length && <div className="muted small">Nothing recorded as blocking.</div>}
          </section>
        </div>
        {project.aiNextSteps && <div className="ai-next"><div className="report-subhead">Suggested questions and next steps</div><div style={{ whiteSpace: "pre-wrap" }}>{project.aiNextSteps}</div></div>}
        <div className="no-print report-project-actions"><QuickNote projectId={project.id} />{ai.configured && <form action={generateNextSteps.bind(null, project.id)}><button className="btn btn-ghost btn-sm">✨ Refresh suggestion</button></form>}</div>
        <div className="print-only"><div className="print-jot-label">Decisions / actions to enter</div><div className="print-jot" /></div>
      </article>;
    })}

    <div className="report-section-head"><h2>Ad-hoc work needing a slot</h2></div>
    <div className="report-adhoc-grid">
      {projects.filter((project) => project.type === "ADHOC").map((project) => {
        const unscheduled = project.tasks.filter((task) => task.status !== "DONE" && !task.plannedDate);
        if (!unscheduled.length) return null;
        return <article className="report-adhoc" key={project.id}>
          <strong>{project.title}</strong><span className="muted small"> · {project.client.name}</span>
          <div className="report-subhead">What do we need to do?</div>
          {unscheduled.slice(0, 5).map((task) => <div key={task.id}>☐ {task.title}</div>)}
          <div className="print-only"><div className="print-jot-label">Plan / notes</div><div className="print-jot" /></div>
        </article>;
      })}
    </div>
  </div>;
}
