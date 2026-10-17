"use client";

import type { ProcessFields } from "@/modules/work/process-domain";
import { PRIORITIES } from "@/modules/work/domain";

export default function TaskFields({ value, onChange, prerequisites, disabled = false }: {
  value: ProcessFields; onChange: (value: ProcessFields) => void;
  prerequisites: { itemId: string; title: string }[]; disabled?: boolean;
}) {
  const change = (patch: Partial<ProcessFields>) => onChange({ ...value, ...patch });
  return <fieldset disabled={disabled} className="process-fields">
    <label>Task title<input value={value.title} required maxLength={200} onChange={e => change({ title: e.target.value })} /></label>
    <details><summary>Instructions, acceptance criteria and planning</summary>
      <div className="stack mt">
        <label>Instructions<textarea value={value.description} rows={3} maxLength={20000} onChange={e => change({ description: e.target.value })} /></label>
        <label>Acceptance criteria<textarea value={value.completionCriteria} rows={2} maxLength={10000} onChange={e => change({ completionCriteria: e.target.value })} /></label>
        <label>SOP link<input type="url" value={value.sopUrl ?? ""} onChange={e => change({ sopUrl: e.target.value || null })} /></label>
        <div className="work-form-grid">
          <label>Priority<select value={value.priority} onChange={e => change({ priority: e.target.value as ProcessFields["priority"] })}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></label>
          <label>Estimated hours<input type="number" min={0} max={10000} step={0.25} value={value.estimatedHours ?? ""} onChange={e => change({ estimatedHours: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        </div>
        <label className="process-check"><input type="checkbox" checked={value.isMilestone} onChange={e => change({ isMilestone: e.target.checked })} />Milestone</label>
        {!!prerequisites.length && <fieldset><legend>Prerequisites</legend>{prerequisites.map(p => <label key={p.itemId} className="process-check">
          <input type="checkbox" checked={value.dependencyIds.includes(p.itemId)} onChange={e => change({ dependencyIds: e.target.checked ? [...value.dependencyIds, p.itemId] : value.dependencyIds.filter(id => id !== p.itemId) })} />{p.title || "Untitled task"}
        </label>)}</fieldset>}
      </div>
    </details>
  </fieldset>;
}
