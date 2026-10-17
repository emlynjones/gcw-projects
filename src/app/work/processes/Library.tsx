"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProcessDraft } from "@/modules/work/process-domain";
import { PROJECT_STAGES, ADHOC_STAGES, STAGE_LABELS } from "@/lib/status";
import TaskFields from "./TaskFields";
import { archiveProcessAction, saveProcessAction, saveWorkTypeAction, type ProcessResult } from "./actions";

export type LibraryGroup = {
  id: string; archived: boolean; editVersion: number; applications: number;
  revisions: (ProcessDraft & { id: string; number: number; published: boolean; author: string; at: string })[];
};
type WorkType = { id: string; name: string; archived: boolean };
const blank = (): ProcessDraft => ({ editVersion: 0, name: "", description: "", changeSummary: "", items: [], rules: [] });

export default function Library({ groups, workTypes }: { groups: LibraryGroup[]; workTypes: WorkType[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProcessDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProcessResult>({});
  const [workName, setWorkName] = useState("");
  const [workNames, setWorkNames] = useState<Record<string, string>>({});
  const run = async (operation: () => Promise<ProcessResult>) => {
    setPending(true); setResult({});
    try {
      const response = await operation(); setResult(response);
      if (response.saved) { setDraft(null); router.refresh(); }
    } finally { setPending(false); }
  };
  const edit = (group: LibraryGroup) => {
    const latest = group.revisions[0];
    setResult({});
    setDraft({ ...latest, templateId: group.id, editVersion: group.editVersion, changeSummary: latest.published ? "" : latest.changeSummary });
  };
  const duplicate = (group: LibraryGroup) => {
    const source = group.revisions[0];
    const ids = new Map(source.items.map(i => [i.itemId, crypto.randomUUID()]));
    setDraft({ ...source, templateId: undefined, editVersion: 0, name: `${source.name} (copy)`, changeSummary: "",
      items: source.items.map(i => ({ ...i, itemId: ids.get(i.itemId)!, dependencyIds: i.dependencyIds.map(id => ids.get(id)!) })),
    }); setResult({});
  };

  return <>
    <div className="page-head"><div><h1>Process Library</h1><p className="muted">Reusable task groups for projects and ad-hoc work.</p></div>
      <button className="btn" disabled={pending} onClick={() => { setDraft(blank()); setResult({}); }}>New group</button>
    </div>
    {result.error && <p role="alert" className="work-warning">{result.error}</p>}
    {result.saved && <p role="status">{result.saved}</p>}
    {draft && <form className="card stack" aria-label="Process template editor" onSubmit={e => { e.preventDefault(); void run(() => saveProcessAction(draft, false)); }}>
      <h2>{draft.templateId ? "Edit group" : "New group"}</h2>
      <fieldset disabled={pending} className="process-fields stack">
        <label>Group name<input required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Description<textarea rows={2} value={draft.description} maxLength={10000} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>Change summary<input maxLength={2000} value={draft.changeSummary} onChange={e => setDraft({ ...draft, changeSummary: e.target.value })} /></label>
        <h3>Standard tasks</h3>
        {draft.items.map((item, index) => <div className="process-item stack" key={item.itemId}>
          <TaskFields value={item} onChange={fields => setDraft({ ...draft, items: draft.items.map(i => i.itemId === item.itemId ? { ...fields, itemId: item.itemId } : i) })} prerequisites={draft.items.filter(i => i.itemId !== item.itemId)} />
          <div className="action-row">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!index} aria-label={`Move task ${index + 1} up`} onClick={() => { const items = [...draft.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; setDraft({ ...draft, items }); }}>↑</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={index === draft.items.length - 1} aria-label={`Move task ${index + 1} down`} onClick={() => { const items = [...draft.items]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; setDraft({ ...draft, items }); }}>↓</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({ ...draft, items: draft.items.filter(i => i.itemId !== item.itemId).map(i => ({ ...i, dependencyIds: i.dependencyIds.filter(id => id !== item.itemId) })) })}>Remove task</button>
          </div>
        </div>)}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft({ ...draft, items: [...draft.items, { itemId: crypto.randomUUID(), title: "", description: "", completionCriteria: "", sopUrl: null, priority: "NORMAL", estimatedHours: null, isMilestone: false, dependencyIds: [] }] })}>Add template task</button>
        <h3>Suggest this group when</h3>
        <p className="muted small">Each row is a matching scenario. All conditions in a row must match. With no rules, the group is available for manual application.</p>
        {draft.rules.map((rule, index) => <div className="work-form-grid process-item" key={index}>
          <label>Project type<select value={rule.projectType ?? ""} onChange={e => setDraft({ ...draft, rules: draft.rules.map((r, n) => n === index ? { ...r, projectType: (e.target.value || null) as typeof rule.projectType, stage: null } : r) })}><option value="">Either</option><option value="PROJECT">Project</option><option value="ADHOC">Ad-hoc</option></select></label>
          <label>Stage<select value={rule.stage ?? ""} onChange={e => setDraft({ ...draft, rules: draft.rules.map((r, n) => n === index ? { ...r, stage: e.target.value || null } : r) })}><option value="">Any stage</option>{[...new Set(rule.projectType === "ADHOC" ? ADHOC_STAGES : rule.projectType === "PROJECT" ? PROJECT_STAGES : [...PROJECT_STAGES, ...ADHOC_STAGES])].map(stage => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}</select></label>
          <label>Work type<select value={rule.workTypeId ?? ""} onChange={e => setDraft({ ...draft, rules: draft.rules.map((r, n) => n === index ? { ...r, workTypeId: e.target.value || null } : r) })}><option value="">Any work type</option>{workTypes.filter(w => !w.archived || w.id === rule.workTypeId).map(w => <option value={w.id} key={w.id}>{w.name}{w.archived ? " (archived)" : ""}</option>)}</select></label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, n) => n !== index) })}>Remove rule</button>
        </div>)}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft({ ...draft, rules: [...draft.rules, { projectType: null, stage: null, workTypeId: null }] })}>Add suggestion rule</button>
        <div className="action-row">
          <button className="btn btn-secondary" type="submit">Save draft</button>
          <button className="btn" type="button" onClick={() => void run(() => saveProcessAction(draft, true))}>Publish version</button>
          <button className="btn btn-ghost" type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </fieldset>
    </form>}
    {!groups.length && !draft && <p className="card muted">Create your first group, such as “Project onboarding” or “Going live checklist”.</p>}
    {groups.map(group => <section className="card stack" key={group.id}>
      <div className="page-head"><div><h2>{group.revisions[0]?.name ?? "Untitled group"}{group.archived ? " (archived)" : ""}</h2><p className="muted">{group.revisions[0]?.description}</p></div>
        <div className="action-row">
          {!group.archived && <button className="btn btn-secondary btn-sm" disabled={pending} onClick={() => edit(group)}>Edit group</button>}
          <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => duplicate(group)}>Duplicate</button>
          <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => void run(() => archiveProcessAction(group.id, group.editVersion, !group.archived))}>{group.archived ? "Restore" : "Archive"}</button>
        </div>
      </div>
      <p className="small">{group.revisions[0]?.items.length ?? 0} tasks · {group.applications} applications · {group.revisions[0]?.published ? `Published v${group.revisions[0].number}` : "Unpublished draft"}</p>
      <details><summary>Versions and standard tasks</summary>
        {group.revisions.map(revision => <div className="process-item" key={revision.id}>
          <strong>{revision.published ? `Version ${revision.number}` : "Draft"} · {revision.author}</strong>
          <span className="muted small"> · {new Date(revision.at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</span>
          {revision.changeSummary && <p>{revision.changeSummary}</p>}
          <ol>{revision.items.map(item => <li key={item.itemId}><strong>{item.title}</strong>{item.description && <p className="process-text">{item.description}</p>}{item.completionCriteria && <p className="process-text">Acceptable work: {item.completionCriteria}</p>}{item.sopUrl && <a href={item.sopUrl} target="_blank" rel="noreferrer">Read SOP ↗</a>}</li>)}</ol>
        </div>)}
      </details>
    </section>)}
    <section className="card stack"><h2>Work types</h2><p className="muted">Classify a project or ad-hoc job to suggest the right processes.</p>
      <form className="action-row" onSubmit={e => { e.preventDefault(); void run(async () => { const response = await saveWorkTypeAction({ name: workName, archived: false }); if (response.saved) setWorkName(""); return response; }); }}>
        <label>Work type name<input value={workName} maxLength={100} required onChange={e => setWorkName(e.target.value)} /></label><button className="btn btn-secondary btn-sm" disabled={pending}>Add work type</button>
      </form>
      {workTypes.map(w => <form className="action-row" key={`${w.id}:${w.name}`} onSubmit={e => { e.preventDefault(); void run(() => saveWorkTypeAction({ ...w, name: workNames[w.id] ?? w.name })); }}>
        <label>Name for {w.name}<input required maxLength={100} value={workNames[w.id] ?? w.name} onChange={e => setWorkNames({ ...workNames, [w.id]: e.target.value })} /></label>
        {w.archived && <span className="muted small">Archived</span>}
        <button className="btn btn-secondary btn-sm" disabled={pending}>Save name</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => void run(() => saveWorkTypeAction({ ...w, archived: !w.archived }))}>{w.archived ? "Restore" : "Archive"}</button>
      </form>)}
    </section>
    <Link href="/work">← Back to work</Link>
  </>;
}
