"use client";

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  addDays,
  monday,
  PRIORITIES,
  STATUSES,
  STATUS_LABELS,
  weeklyLoad,
} from "@/modules/work/domain";
import type { WorkData } from "@/modules/work/application";
import TaskEditor from "./TaskEditor";
import { saveCapacityAction } from "./actions";

type Task = WorkData["tasks"][number];
type Mode = "mine" | "all" | "planner" | "kanban" | "project";

function EditorDialog({
  children,
  close,
}: {
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="work-modal"
      aria-label="Edit task"
      onCancel={close}
      onClose={close}
    >
      {children}
    </dialog>
  );
}

function Capacity({
  userId,
  weekStart,
  hours,
}: {
  userId: string;
  weekStart: string;
  hours?: number;
}) {
  const [state, action, pending] = useActionState(saveCapacityAction, {});
  return (
    <form action={action} className="work-capacity">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="weekStart" value={weekStart} />
      <label>
        Available hours
        <input
          aria-label="Available hours"
          type="number"
          name="hours"
          required
          min="0"
          max="168"
          step="0.25"
          defaultValue={hours ?? ""}
          placeholder="Set capacity"
        />
      </label>
      <button className="btn btn-secondary btn-sm" disabled={pending}>
        Save capacity
      </button>
      {state.error && <span role="alert">{state.error}</span>}
      {state.saved && <span role="status">Saved</span>}
    </form>
  );
}

export default function Workbench({
  data,
  currentUserId,
  today,
  projectId,
  mode = "mine",
  initialWeek,
}: {
  data: WorkData;
  currentUserId: string;
  today: string;
  projectId?: string;
  mode?: Mode;
  initialWeek?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [parent, setParent] = useState("");
  const [showDone, setShowDone] = useState(mode === "kanban");
  const [editing, setEditing] = useState<Task | null>(null);
  const [captureKey, setCaptureKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [week, setWeek] = useState(initialWeek ?? monday(today));
  const saved = useCallback(() => {
    setEditing(null);
    setCaptureKey((value) => value + 1);
    setNotice("Task saved");
    router.refresh();
  }, [router]);
  const scoped = data.tasks.filter(
    (task) =>
      (!projectId || task.projectId === projectId) &&
      (mode !== "mine" || task.assigneeId === currentUserId),
  );
  const outstanding = scoped.filter((task) => task.status !== "DONE");
  const overdue = outstanding.filter(
    (task) => task.dueDate && task.dueDate < today,
  );
  const blocked = (task: Task) =>
    task.dependencyIds.some(
      (id) =>
        data.tasks.find((candidate) => candidate.id === id)?.status !== "DONE",
    );
  const tasks = scoped
    .filter(
      (task) =>
        (showDone || status === "DONE" || task.status !== "DONE") &&
        (!query ||
          `${task.title} ${task.description}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!person ||
          (person === "unassigned"
            ? !task.assigneeId
            : task.assigneeId === person)) &&
        (!status || task.status === status) &&
        (!priority || task.priority === priority) &&
        (!parent || task.projectId === parent),
    )
    .sort(
      (a, b) =>
        PRIORITIES.indexOf(a.priority as (typeof PRIORITIES)[number]) -
          PRIORITIES.indexOf(b.priority as (typeof PRIORITIES)[number]) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    );
  const taskProject = (task: Task) =>
    data.projects.find((project) => project.id === task.projectId);
  const card = (task: Task) => (
    <article className="work-task" key={task.id}>
      <div className="work-task-heading">
        <button
          type="button"
          className="work-title"
          disabled={taskProject(task)?.archived}
          onClick={() => {
            setEditing(task);
            setNotice("");
          }}
        >
          {task.isMilestone ? "◆ " : ""}
          {task.title}
        </button>
        <span
          className={`work-priority work-priority-${task.priority.toLowerCase()}`}
        >
          {task.priority}
        </span>
      </div>
      {!projectId && (
        <Link
          href={`/projects/${task.projectId}#tasks`}
          className="muted small"
        >
          {taskProject(task)?.title}{" "}
          {taskProject(task)?.type === "ADHOC" ? "· Ad hoc" : ""}
        </Link>
      )}
      <p className="small">
        {data.people.find((user) => user.id === task.assigneeId)?.name ??
          "Unassigned"}{" "}
        · {STATUS_LABELS[task.status]} ·{" "}
        {task.estimatedHours === null
          ? "Estimate needed"
          : `${task.estimatedHours}h`}
      </p>
      <p className="small">
        Planned: {task.plannedDate ?? "Not scheduled"} · Due:{" "}
        <span
          className={
            task.dueDate && task.dueDate < today && task.status !== "DONE"
              ? "work-warning"
              : ""
          }
        >
          {task.dueDate ?? "Not set"}
        </span>
      </p>
      {task.status !== "DONE" && blocked(task) && (
        <p className="work-warning small">Waiting on prerequisites</p>
      )}
      {task.plannedDate && task.dueDate && task.plannedDate > task.dueDate && (
        <p className="work-warning small">Planned after deadline</p>
      )}
      {task.completionCriteria && (
        <p className="small">Done when: {task.completionCriteria}</p>
      )}
      {task.sopUrl && (
        <a href={task.sopUrl} target="_blank" rel="noreferrer">
          Open process ↗
        </a>
      )}
    </article>
  );
  const selected = editing;
  return (
    <section className="workbench" id="tasks">
      <div className="page-head">
        <div>
          <h1>
            {mode === "project"
              ? "Tasks & milestones"
              : mode === "mine"
                ? "My Work"
                : mode === "planner"
                  ? "Weekly Planner"
                  : mode === "kanban"
                    ? "Task board"
                    : "All Work"}
          </h1>
          <p className="muted">
            {mode === "mine"
              ? "Your next priorities, planned work and deadlines."
              : "One task list across projects and ad hoc work."}
          </p>
        </div>
      </div>
      <nav className="action-row work-nav" aria-label="Work views">
        {[
          ["mine", "My Work"],
          ["all", "All Work"],
          ["planner", "Weekly Planner"],
          ["kanban", "Kanban"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/work?view=${key}`}
            className={`btn ${mode === key ? "" : "btn-secondary"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="work-stats">
        <div>
          <strong>{outstanding.length}</strong> outstanding
        </div>
        <div>
          <strong>{overdue.length}</strong> overdue
        </div>
        <div>
          <strong>
            {
              outstanding.filter(
                (task) =>
                  task.priority === "URGENT" || task.priority === "HIGH",
              ).length
            }
          </strong>{" "}
          high / urgent
        </div>
        <div>
          <strong>
            {scoped.filter((task) => task.status === "DONE").length}/
            {scoped.length}
          </strong>{" "}
          completed
        </div>
      </div>
      {mode === "project" && (
        <div className="card">
          <label>
            Task progress{" "}
            <progress
              max={scoped.length || 1}
              value={scoped.filter((task) => task.status === "DONE").length}
            />
          </label>
          <p>
            Milestones:{" "}
            {
              scoped.filter(
                (task) => task.isMilestone && task.status === "DONE",
              ).length
            }{" "}
            / {scoped.filter((task) => task.isMilestone).length} complete
          </p>
          <p className="muted small">
            Progress is based on task count. Project stage and billing are
            managed separately.
          </p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {selected && (
        <EditorDialog close={() => setEditing(null)}>
          <h2>Edit task</h2>
          <TaskEditor
            key={selected.id}
            data={data}
            task={selected}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        </EditorDialog>
      )}
      {!data.projects.find((project) => project.id === projectId)?.archived && (
        <div className="card">
          <h2>Quick add</h2>
          <TaskEditor
            key={captureKey}
            data={data}
            projectId={projectId}
            defaultAssigneeId={mode === "mine" ? currentUserId : undefined}
            onSaved={saved}
          />
        </div>
      )}
      <div className="work-filters">
        <label>
          Search tasks
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or description"
          />
        </label>
        {mode !== "mine" && (
          <label>
            Assigned person
            <select
              value={person}
              onChange={(event) => setPerson(event.target.value)}
            >
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {data.people.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!projectId && (
          <label>
            Project / job
            <select
              value={parent}
              onChange={(event) => setParent(event.target.value)}
            >
              <option value="">All projects & jobs</option>
              {data.projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option value={value} key={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />{" "}
          Include completed
        </label>
      </div>
      {mode === "planner" ? (
        <>
          <div className="action-row">
            <button
              className="btn btn-secondary"
              onClick={() => setWeek(addDays(week, -7))}
            >
              ← Previous week
            </button>
            <label>
              Week of
              <input
                type="date"
                value={week}
                onChange={(event) => {
                  if (event.target.value) setWeek(monday(event.target.value));
                }}
              />
            </label>
            <button
              className="btn btn-secondary"
              onClick={() => setWeek(addDays(week, 7))}
            >
              Next week →
            </button>
          </div>
          <p className="muted">
            Set available hours after leave and other commitments. Full
            estimates count in the planned week, including completed work.
            Capacity totals include all work, regardless of filters. Click a
            task to assign or reschedule it.
          </p>
          <div className="work-planner">
            {[
              ...data.people.map((user) => ({
                id: user.id as string | null,
                name: user.name,
              })),
              { id: null, name: "Unassigned" },
            ].map((user) => {
              const load = weeklyLoad(data.tasks, user.id, week);
              const capacity = data.capacities.find(
                (value) => value.userId === user.id && value.weekStart === week,
              )?.hours;
              return (
                <section className="card" key={user.id ?? "unassigned"}>
                  <h2>{user.name}</h2>
                  <p
                    className={
                      capacity !== undefined && load.hours > capacity
                        ? "work-warning"
                        : ""
                    }
                  >
                    {load.hours}h allocated /{" "}
                    {capacity === undefined
                      ? "capacity not set"
                      : `${capacity}h available`}
                    {capacity !== undefined && load.hours > capacity
                      ? ` · ${+(load.hours - capacity).toFixed(2)}h over capacity`
                      : ""}
                  </p>
                  {load.missing > 0 && (
                    <p className="work-warning">
                      {load.missing} scheduled tasks need estimates
                    </p>
                  )}
                  {user.id && (
                    <Capacity
                      key={`${user.id}-${week}`}
                      userId={user.id}
                      weekStart={week}
                      hours={capacity}
                    />
                  )}
                  <div className="work-days">
                    {Array.from({ length: 7 }, (_, index) =>
                      addDays(week, index),
                    ).map((day) => (
                      <div key={day}>
                        <h3>
                          {new Date(`${day}T12:00:00Z`).toLocaleDateString(
                            "en-GB",
                            {
                              weekday: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            },
                          )}
                        </h3>
                        {tasks
                          .filter(
                            (task) =>
                              task.assigneeId === user.id &&
                              task.plannedDate === day,
                          )
                          .map(card)}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <h2>
            Needs scheduling ({tasks.filter((task) => !task.plannedDate).length}
            )
          </h2>
          <div className="work-list">
            {tasks.filter((task) => !task.plannedDate).map(card)}
          </div>
        </>
      ) : mode === "kanban" ? (
        <div className="work-board">
          {STATUSES.map((value) => (
            <section key={value}>
              <h2>
                {STATUS_LABELS[value]}{" "}
                <span className="muted">
                  {tasks.filter((task) => task.status === value).length}
                </span>
              </h2>
              {tasks.filter((task) => task.status === value).map(card)}
            </section>
          ))}
        </div>
      ) : (
        <div className="work-list">{tasks.map(card)}</div>
      )}
      {!tasks.length && (
        <p className="card muted">
          No tasks match this view. Add a task above or adjust your filters.
        </p>
      )}
    </section>
  );
}
