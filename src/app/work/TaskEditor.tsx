"use client";

import { useActionState, useEffect, useState } from "react";
import { saveTaskAction } from "./actions";
import { PRIORITIES, STATUSES, STATUS_LABELS } from "@/modules/work/domain";
import type { WorkData } from "@/modules/work/application";

type Task = WorkData["tasks"][number];
export default function TaskEditor({
  data,
  task,
  projectId,
  defaultAssigneeId,
  onSaved,
  onCancel,
  variant = "full",
  rowValues,
}: {
  data: WorkData;
  task?: Task;
  projectId?: string;
  defaultAssigneeId?: string;
  onSaved: (version?: number) => void;
  onCancel?: () => void;
  // "details" is the expanded panel of the task table: title, status,
  // assignee and due date are edited inline, so they travel as hidden inputs.
  variant?: "full" | "details";
  rowValues?: {
    title: string;
    status: string;
    assigneeId: string;
    dueDate: string;
  };
}) {
  const compact = variant === "details" && !!task && !!rowValues;
  const [state, action, pending] = useActionState(saveTaskAction, {});
  const [parent, setParent] = useState(task?.projectId ?? projectId ?? "");
  useEffect(() => {
    if (state.saved) onSaved(state.version);
  }, [state.saved, state.version, onSaved]);
  return (
    <form
      action={action}
      className="stack work-editor"
      aria-label={task ? "Edit task" : "Quick add task"}
    >
      {task && <input type="hidden" name="id" value={task.id} />}
      <input type="hidden" name="version" value={task?.version ?? 0} />
      {compact && rowValues && (
        <>
          <input type="hidden" name="projectId" value={task.projectId} />
          <input type="hidden" name="title" value={rowValues.title} />
          <input type="hidden" name="status" value={rowValues.status} />
          <input type="hidden" name="assigneeId" value={rowValues.assigneeId} />
          <input type="hidden" name="dueDate" value={rowValues.dueDate} />
        </>
      )}
      <div className="work-form-grid">
        {!compact && (
          <>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={task?.title}
                placeholder="What needs doing?"
              />
            </label>
            {task || projectId ? (
              <input type="hidden" name="projectId" value={parent} />
            ) : (
              <label>
                Project or ad hoc job
                <select
                  name="projectId"
                  required
                  value={parent}
                  onChange={(event) => setParent(event.target.value)}
                >
                  <option value="">Choose project or job…</option>
                  {data.projects
                    .filter((p) => !p.archived)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                        {p.type === "ADHOC" ? " · Ad hoc" : ""}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Assigned person
              <select
                name="assigneeId"
                defaultValue={
                  task ? (task.assigneeId ?? "") : (defaultAssigneeId ?? "")
                }
              >
                <option value="">Unassigned</option>
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          Priority
          <select name="priority" defaultValue={task?.priority ?? "NORMAL"}>
            {PRIORITIES.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
        </label>
        {!compact && (
          <label>
            Due date
            <input
              type="date"
              name="dueDate"
              defaultValue={task?.dueDate ?? ""}
            />
          </label>
        )}
      </div>
      <details open={task ? true : undefined}>
        <summary>Details, planning and dependencies</summary>
        <div className="work-form-grid mt">
          {!compact && (
            <label>
              Status
              <select name="status" defaultValue={task?.status ?? "TODO"}>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Estimated hours
            <input
              type="number"
              name="estimatedHours"
              min="0"
              max="10000"
              step="0.25"
              defaultValue={task?.estimatedHours ?? ""}
            />
          </label>
          <label>
            Planned date
            <input
              type="date"
              name="plannedDate"
              defaultValue={task?.plannedDate ?? ""}
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            rows={3}
            maxLength={20000}
            defaultValue={task?.description}
          />
        </label>
        <label>
          Completion criteria
          <textarea
            name="completionCriteria"
            rows={2}
            maxLength={10000}
            defaultValue={task?.completionCriteria}
            placeholder="What must be true for this task to be done?"
          />
        </label>
        <label>
          SOP or process link
          <input
            type="url"
            name="sopUrl"
            defaultValue={task?.sopUrl ?? ""}
            placeholder="https://…"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            name="isMilestone"
            defaultChecked={task?.isMilestone}
          />{" "}
          Milestone
        </label>
        <fieldset className="work-dependencies" key={parent}>
          <legend>Depends on (same project/job)</legend>
          {data.tasks
            .filter(
              (candidate) =>
                candidate.projectId === parent && candidate.id !== task?.id,
            )
            .map((candidate) => (
              <label className="check-row" key={candidate.id}>
                <input
                  type="checkbox"
                  name="dependencyIds"
                  value={candidate.id}
                  defaultChecked={task?.dependencyIds.includes(candidate.id)}
                />
                {candidate.title} · {STATUS_LABELS[candidate.status]}
              </label>
            ))}
          {!data.tasks.some(
            (candidate) =>
              candidate.projectId === parent && candidate.id !== task?.id,
          ) && <p className="muted">No other tasks in this project yet.</p>}
        </fieldset>
      </details>
      {state.error && (
        <p role="alert" className="work-warning">
          {state.error}
        </p>
      )}
      <div className="action-row">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : task ? "Save task" : "Add task"}
        </button>
        {onCancel && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
