"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { getProjectProcesses } from "@/modules/work/processes";
import type { ApplyProcessInput, ProcessField } from "@/modules/work/process-domain";
import { FIELD_LABELS } from "@/modules/work/process-domain";
import TaskFields from "./TaskFields";
import { applyProcessAction, dismissProcessAction, setWorkTypeAction, updateProcessAction, type ProcessResult } from "./actions";

type Data = Awaited<ReturnType<typeof getProjectProcesses>>;
type Application = Data["applications"][number];

function UpdateReview({ application, projectId, run, pending }: {
  application: Application; projectId: string; run: (operation: () => Promise<ProcessResult>) => Promise<void>; pending: boolean;
}) {
  const [choices, setChoices] = useState<Record<string, "accept" | "keep" | "">>({});
  const [additions, setAdditions] = useState<string[]>([]);
  const changes = application.items.filter(item => item.diffs.length || (!item.taskId && !item.deleted));
  const labelValue = (value: unknown) => Array.isArray(value)
    ? value.map(id => application.items.find(i => i.itemId === id)?.title ?? "Other project task").join(", ") || "None"
    : value === null || value === "" ? "None" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return <details className="process-update">
    <summary>{changes.length ? `Review template updates · v${application.latestNumber}` : "Applied process details"}</summary>
    <div className="stack mt">
      {changes.map(item => <div className="process-item stack" key={item.itemId}>
        <strong>{item.title}{item.done ? " · Completed task" : ""}</strong>
        {!item.taskId && !item.deleted ? <label className="process-check"><input type="checkbox" disabled={pending} checked={additions.includes(item.itemId)} onChange={e => setAdditions(e.target.checked ? [...additions, item.itemId] : additions.filter(id => id !== item.itemId))} />Add new task from template</label> :
          item.diffs.map(diff => {
            const key = `${item.itemId}:${diff.field}`;
            return <div className="process-field-review" key={diff.field}>
              <strong>{FIELD_LABELS[diff.field]}{diff.conflict ? " · Customised on this project" : ""}</strong>
              <dl><dt>Previous template</dt><dd className="process-text">{labelValue(diff.before)}</dd><dt>Project value</dt><dd className="process-text">{labelValue(diff.current)}</dd><dt>New template</dt><dd className="process-text">{labelValue(diff.next)}</dd></dl>
              <label>Decision for {item.title}: {FIELD_LABELS[diff.field]}<select disabled={pending} value={choices[key] ?? ""} onChange={e => setChoices({ ...choices, [key]: e.target.value as "accept" | "keep" | "" })}>
                <option value="">Leave for later</option><option value="accept">Use new template value</option><option value="keep">Keep project value</option>
              </select></label>
            </div>;
          })}
      </div>)}
      {!!application.removed.length && <p className="muted">Removed from the latest template; retained on this project: {application.removed.join(", ")}.</p>}
      {application.items.some(i => i.deleted) && <p className="muted">Tasks deleted from this project stay deleted when reviewing updates.</p>}
      {!!changes.length && <button className="btn btn-sm" disabled={pending || (!additions.length && !Object.values(choices).some(Boolean))} onClick={() => void run(() => updateProcessAction({
        projectId, applicationId: application.id, revisionId: application.latestRevisionId, version: application.version, additions,
        choices: application.items.flatMap(item => item.diffs.flatMap(diff => {
          const choice = choices[`${item.itemId}:${diff.field}`];
          return choice ? [{ itemId: item.itemId, taskVersion: item.taskVersion, field: diff.field as ProcessField, choice }] : [];
        })),
      }))}>Apply selected updates</button>}
      <details><summary>Application history</summary><ul>{application.history.map(event => <li key={event.id}>
        {event.actor} · version {event.number} · {new Date(event.at).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}
        <div>{event.summary}</div>
        {!!event.choices.length && <ul>{event.choices.map(choice => <li key={`${choice.itemId}:${choice.field}`}>{choice.title} · {FIELD_LABELS[choice.field]}: {choice.choice === "accept" ? "Used template value" : "Kept project value"}</li>)}</ul>}
      </li>)}</ul></details>
    </div>
  </details>;
}

export default function ProjectProcesses({ projectId, data }: { projectId: string; data: Data }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProcessResult>({});
  const [preview, setPreview] = useState<ApplyProcessInput | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [choose, setChoose] = useState(false);
  const [workType, setWorkType] = useState(data.workTypeId ?? "");
  const run = async (operation: () => Promise<ProcessResult>) => {
    setPending(true); setResult({});
    try {
      const response = await operation(); setResult(response);
      if (response.saved) { setPreview(null); router.refresh(); }
    } finally { setPending(false); }
  };
  const open = (template: Data["templates"][number], copy = false) => {
    setPreview({ projectId, revisionId: template.revisionId, occurrence: copy ? crypto.randomUUID() : "primary",
      items: template.items.map(i => ({ ...i, assigneeId: null, dueDate: null, plannedDate: null })),
    });
    setSelected(template.items.map(i => i.itemId)); setResult({}); setChoose(false);
  };
  if (data.archived) return null;
  return <section className="card stack" aria-label="Project processes">
    <div className="page-head"><h2>Processes and templates</h2><div className="action-row">
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setChoose(!choose)}>Apply template</button>
      <Link className="small" href="/work/processes">Process Library ↗</Link>
    </div></div>
    <form className="action-row" onSubmit={e => { e.preventDefault(); void run(() => setWorkTypeAction(projectId, workType || null)); }}>
      <label>Work type<select value={workType} disabled={pending} onChange={e => setWorkType(e.target.value)}><option value="">Unclassified</option>{data.workTypes.filter(w => !w.archived || w.id === data.workTypeId).map(w => <option key={w.id} value={w.id}>{w.name}{w.archived ? " (archived)" : ""}</option>)}</select></label>
      <button className="btn btn-ghost btn-sm" disabled={pending}>Save work type</button>
    </form>
    {result.error && <p role="alert" className="work-warning">{result.error}</p>}
    {result.saved && <p role="status">{result.saved}</p>}
    {data.templates.filter(t => t.suggested).map(template => <div className="action-row process-item" key={template.id}>
      <span>Suggested process: <strong>{template.name}</strong> · {template.items.length} tasks</span>
      <button className="btn btn-secondary btn-sm" disabled={pending} onClick={() => open(template)}>Review and apply</button>
      <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => void run(() => dismissProcessAction(projectId, template.id))}>Dismiss</button>
    </div>)}
    {choose && <div className="stack process-item">
      {!data.templates.length && <p className="muted">Publish a group in the Process Library to make it available here.</p>}
      {data.templates.map(template => {
        const used = data.applications.some(a => a.templateId === template.id);
        return <div className="action-row" key={template.id}><span>{template.name} · v{template.number} · {template.items.length} tasks</span>
          <button className="btn btn-secondary btn-sm" disabled={pending} onClick={() => open(template)}>{used ? "Review existing template" : "Review tasks"}</button>
          {used && <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => open(template, true)}>Apply another copy</button>}
        </div>;
      })}
    </div>}
    {preview && <div className="stack process-preview">
      <h3>Review template tasks</h3><p className="muted">Select and customise tasks before creating them. Include prerequisites or remove their dependencies.</p>
      {preview.items.map((item, index) => <div className="process-item stack" key={item.itemId}>
        <label className="process-check"><input type="checkbox" disabled={pending} checked={selected.includes(item.itemId)} onChange={e => setSelected(e.target.checked ? [...selected, item.itemId] : selected.filter(id => id !== item.itemId))} />Include task {index + 1}</label>
        <TaskFields value={item} disabled={pending} prerequisites={preview.items.filter(i => i.itemId !== item.itemId)} onChange={fields => setPreview({ ...preview, items: preview.items.map(i => i.itemId === item.itemId ? { ...i, ...fields } : i) })} />
        <div className="work-form-grid">
          <label>Assigned person<select disabled={pending} value={item.assigneeId ?? ""} onChange={e => setPreview({ ...preview, items: preview.items.map(i => i.itemId === item.itemId ? { ...i, assigneeId: e.target.value || null } : i) })}><option value="">Unassigned</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Due date<input type="date" disabled={pending} value={item.dueDate ?? ""} onChange={e => setPreview({ ...preview, items: preview.items.map(i => i.itemId === item.itemId ? { ...i, dueDate: e.target.value || null } : i) })} /></label>
          <label>Planned date<input type="date" disabled={pending} value={item.plannedDate ?? ""} onChange={e => setPreview({ ...preview, items: preview.items.map(i => i.itemId === item.itemId ? { ...i, plannedDate: e.target.value || null } : i) })} /></label>
        </div>
      </div>)}
      <div className="action-row"><button className="btn btn-sm" disabled={pending || !selected.length} onClick={() => void run(() => applyProcessAction({ ...preview, items: preview.items.filter(i => selected.includes(i.itemId)) }))}>{pending ? "Creating…" : `Create ${selected.length} reviewed tasks`}</button>
        <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setPreview(null)}>Cancel</button></div>
    </div>}
    {data.applications.map(application => <div className="process-item" key={`${application.id}:${application.version}:${application.latestRevisionId}`}>
      <strong>{application.name}</strong><span className="muted small"> · applied from v{application.number}</span>
      <UpdateReview application={application} projectId={projectId} run={run} pending={pending} />
    </div>)}
  </section>;
}
