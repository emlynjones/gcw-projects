"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STATUSES, STATUS_LABELS } from "@/modules/work/domain";
import type { WorkData } from "@/modules/work/application";
import TaskEditor from "./TaskEditor";
import {
  createTaskRowAction,
  deleteTaskAction,
  updateTaskRowAction,
} from "./actions";

type Task = WorkData["tasks"][number];
type RowValues = {
  title: string;
  status: string;
  assigneeId: string;
  dueDate: string;
};

const valuesOf = (task: Task): RowValues => ({
  title: task.title,
  status: task.status,
  assigneeId: task.assigneeId ?? "",
  dueDate: task.dueDate ?? "",
});
const initials = (name?: string) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

function Avatar({ name }: { name?: string }) {
  return (
    <span
      className={`task-avatar${name ? "" : " task-avatar-empty"}`}
      aria-hidden="true"
    >
      {initials(name) || "–"}
    </span>
  );
}

function TaskRow({
  task,
  data,
  today,
  locked,
  waiting,
  expanded,
  onToggle,
}: {
  task: Task;
  data: WorkData;
  today: string;
  locked: boolean;
  waiting: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(valuesOf(task));
  const [committed, setCommitted] = useState(valuesOf(task));
  const [version, setVersion] = useState(task.version);
  // A save returns revalidated data; adopt the stored row when its version moves.
  const [seenVersion, setSeenVersion] = useState(task.version);
  if (task.version !== seenVersion) {
    setSeenVersion(task.version);
    setValues(valuesOf(task));
    setCommitted(valuesOf(task));
    setVersion(task.version);
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(patch: Partial<RowValues>) {
    setPending(true);
    setError("");
    const result = await updateTaskRowAction(task.id, version, patch);
    setPending(false);
    if (result.error) {
      // Show the server's reason and put the cell back to what is stored.
      setError(result.error);
      setValues(committed);
      return;
    }
    setCommitted({ ...committed, ...patch });
    setVersion(result.version ?? version + 1);
    router.refresh();
  }
  const change = (patch: Partial<RowValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    void save(patch);
  };
  const assignee = data.people.find(
    (person) => person.id === values.assigneeId,
  );
  const overdue =
    !!values.dueDate && values.dueDate < today && values.status !== "DONE";
  const off = locked || pending;
  const saved = useCallback(() => {
    onToggle();
    router.refresh();
  }, [onToggle, router]);

  return (
    <>
      <tr
        className={
          values.status === "DONE" ? "task-row task-row-done" : "task-row"
        }
      >
        <td className="task-cell-toggle">
          <button
            type="button"
            className="task-toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${values.title}`}
            onClick={onToggle}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <div className="task-title-cell">
            <input
              className="task-input"
              aria-label="Task name"
              value={values.title}
              disabled={off}
              maxLength={200}
              onChange={(event) =>
                setValues({ ...values, title: event.target.value })
              }
              onBlur={() => {
                const title = values.title.trim();
                if (!title) return setValues(committed);
                if (title !== committed.title) void save({ title });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setValues(committed);
                  event.currentTarget.blur();
                }
              }}
            />
            {task.isMilestone && (
              <span className="task-flag" title="Milestone">
                ◆
              </span>
            )}
            {(task.priority === "URGENT" || task.priority === "HIGH") && (
              <span
                className={`work-priority work-priority-${task.priority.toLowerCase()}`}
              >
                {task.priority}
              </span>
            )}
            {waiting && values.status !== "DONE" && (
              <span
                className="task-flag work-warning"
                title="Waiting on prerequisites"
              >
                ⧖
              </span>
            )}
          </div>
          {task.processOrigin && <div className="task-process-origin muted small" title={`Applied from template version ${task.processOrigin.number}`}>{task.processOrigin.name} · v{task.processOrigin.number}</div>}
        </td>
        <td>
          <select
            className={`task-status task-status-${values.status.toLowerCase()}`}
            aria-label="Status"
            value={values.status}
            disabled={off}
            onChange={(event) => change({ status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </td>
        <td>
          <div className="task-assignee">
            <Avatar name={assignee?.name} />
            <select
              className="task-input"
              aria-label="Assigned person"
              value={values.assigneeId}
              disabled={off}
              onChange={(event) => change({ assigneeId: event.target.value })}
            >
              <option value="">Not assigned</option>
              {data.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        </td>
        <td>
          <input
            type="date"
            className={`task-input${overdue ? " task-overdue" : ""}`}
            aria-label="Due date"
            value={values.dueDate}
            disabled={off}
            onChange={(event) => change({ dueDate: event.target.value })}
          />
        </td>
      </tr>
      {error && (
        <tr>
          <td />
          <td colSpan={4} role="alert" className="work-warning task-error">
            {error}
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="task-expanded">
          <td />
          <td colSpan={4}>
            <TaskEditor
              data={data}
              task={{ ...task, version }}
              variant="details"
              rowValues={values}
              onSaved={saved}
              onCancel={onToggle}
            />
            {!locked && (
              <DeleteTask
                taskId={task.id}
                projectId={task.projectId}
                version={version}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DeleteTask({
  taskId,
  projectId,
  version,
}: {
  taskId: string;
  projectId: string;
  version: number;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <div className="task-delete">
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={async () => {
          if (!window.confirm("Delete this task? This cannot be undone."))
            return;
          const result = await deleteTaskAction(taskId, projectId, version);
          if (result.error) setError(result.error);
          else router.refresh();
        }}
      >
        Delete task
      </button>
      {error && (
        <span role="alert" className="work-warning">
          {" "}
          {error}
        </span>
      )}
    </div>
  );
}

function AddTask({
  data,
  projectId,
  defaultAssigneeId,
  onClose,
}: {
  data: WorkData;
  projectId: string;
  defaultAssigneeId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [row, setRow] = useState<RowValues>({
    title: "",
    status: "TODO",
    assigneeId: defaultAssigneeId,
    dueDate: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!row.title.trim() || pending) return;
    setPending(true);
    setError("");
    const result = await createTaskRowAction(projectId, row);
    setPending(false);
    if (result.error) return setError(result.error);
    // Keep status, assignee and due date so a run of similar tasks is quick.
    setRow({ ...row, title: "" });
    router.refresh();
    titleRef.current?.focus();
  }
  return (
    <form
      className="task-add"
      aria-label="Add task"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <input
        ref={titleRef}
        className="task-input task-add-title"
        aria-label="New task name"
        placeholder="Task name"
        autoFocus
        maxLength={200}
        value={row.title}
        onChange={(event) => setRow({ ...row, title: event.target.value })}
      />
      <select
        className={`task-status task-status-${row.status.toLowerCase()}`}
        aria-label="New task status"
        value={row.status}
        onChange={(event) => setRow({ ...row, status: event.target.value })}
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <select
        className="task-input"
        aria-label="New task assigned person"
        value={row.assigneeId}
        onChange={(event) => setRow({ ...row, assigneeId: event.target.value })}
      >
        <option value="">Not assigned</option>
        {data.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        className="task-input"
        aria-label="New task due date"
        value={row.dueDate}
        onChange={(event) => setRow({ ...row, dueDate: event.target.value })}
      />
      <button className="btn btn-sm" disabled={pending || !row.title.trim()}>
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onClose}
      >
        Done
      </button>
      {error && (
        <p role="alert" className="work-warning task-add-error">
          {error}
        </p>
      )}
    </form>
  );
}

export default function TaskTable({
  data,
  projectId,
  today,
  archived,
}: {
  data: WorkData;
  projectId: string;
  today: string;
  archived: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const done = tasks.filter((task) => task.status === "DONE").length;
  const overdue = tasks.filter(
    (task) => task.status !== "DONE" && task.dueDate && task.dueDate < today,
  ).length;
  const milestones = tasks.filter((task) => task.isMilestone);
  const waiting = (task: Task) =>
    task.dependencyIds.some(
      (id) => data.tasks.find((other) => other.id === id)?.status !== "DONE",
    );

  return (
    <section className="card task-panel" id="tasks">
      <div className="task-panel-head">
        <h2>Tasks</h2>
        <p className="muted small">
          {done}/{tasks.length} done
          {overdue > 0 && (
            <>
              {" · "}
              <span className="work-warning">{overdue} overdue</span>
            </>
          )}
          {milestones.length > 0 &&
            ` · Milestones ${milestones.filter((task) => task.status === "DONE").length}/${milestones.length}`}
        </p>
      </div>
      <div className="task-table-wrap">
        <table className="task-table">
          <thead>
            <tr>
              <th aria-label="Details" />
              <th>Task</th>
              <th>Status</th>
              <th>Assigned</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                data={data}
                today={today}
                locked={archived}
                waiting={waiting(task)}
                expanded={expandedId === task.id}
                onToggle={() =>
                  setExpandedId((id) => (id === task.id ? null : task.id))
                }
              />
            ))}
            {!tasks.length && (
              <tr>
                <td />
                <td colSpan={4} className="muted">
                  No tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!archived &&
        (adding ? (
          <AddTask
            data={data}
            projectId={projectId}
            defaultAssigneeId=""
            onClose={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm task-add-button"
            onClick={() => setAdding(true)}
          >
            + Add task
          </button>
        ))}
    </section>
  );
}
