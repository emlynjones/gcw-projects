"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote, logHours, setProjectStage } from "@/app/actions";
import { createTaskRowAction, updateTaskRowAction } from "@/app/work/actions";

// Adapters only: every control calls the same server actions the project and
// work pages use, then refreshes so the report re-reads the saved state.

export function StageSelect({
  projectId,
  stage,
  options,
}: {
  projectId: string;
  stage: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="no-print">
      <select
        value={stage}
        disabled={pending}
        aria-label="Change stage"
        onChange={(e) => {
          setError("");
          start(async () => {
            try {
              await setProjectStage(projectId, e.target.value);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to change stage");
            }
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <div className="paid-no small">{error}</div>}
    </span>
  );
}

export function QuickNote({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  return (
    <form
      className="inline-form no-print"
      style={{ marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const fd = new FormData();
        fd.set("body", body);
        start(async () => {
          await addNote(projectId, fd);
          setBody("");
          router.refresh();
        });
      }}
    >
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note from the meeting…"
        aria-label="Add note"
        style={{ flex: 1 }}
      />
      <button type="submit" className="btn btn-sm" disabled={pending || !body.trim()}>
        Add
      </button>
    </form>
  );
}

export function HoursInput({ projectId, hours }: { projectId: string; hours: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <input
      type="number"
      step="0.25"
      min="0"
      defaultValue={hours ?? ""}
      disabled={pending}
      aria-label="Hours done"
      style={{ width: 70 }}
      onBlur={(e) => {
        if (e.target.value === String(hours ?? "")) return;
        const fd = new FormData();
        fd.set("hoursDone", e.target.value);
        start(async () => {
          await logHours(projectId, fd);
          router.refresh();
        });
      }}
    />
  );
}

type TaskItem = { id: string; title: string; status: string; version: number };

export function TaskChecklist({
  projectId,
  initial,
}: {
  projectId: string;
  initial: TaskItem[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();

  const toggle = (task: TaskItem) => {
    const status = task.status === "DONE" ? "TODO" : "DONE";
    setError("");
    start(async () => {
      const result = await updateTaskRowAction(task.id, task.version, { status });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTasks((list) =>
        list.map((t) =>
          t.id === task.id ? { ...t, status, version: result.version ?? t.version } : t,
        ),
      );
      router.refresh();
    });
  };

  const add = () => {
    const value = title.trim();
    if (!value) return;
    setError("");
    start(async () => {
      const result = await createTaskRowAction(projectId, {
        title: value,
        status: "TODO",
        assigneeId: "",
        dueDate: "",
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      // Server data is the source of truth for the new task's id/version.
      router.refresh();
    });
  };

  return (
    <div className="report-tasks">
      {tasks.map((t) => (
        <label key={t.id} className="report-task" style={{ display: "flex", gap: 8, padding: "2px 0" }}>
          <input
            type="checkbox"
            checked={t.status === "DONE"}
            disabled={pending}
            onChange={() => toggle(t)}
          />
          <span
            style={t.status === "DONE" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}
          >
            {t.title}
          </span>
        </label>
      ))}
      {tasks.length === 0 && <div className="muted small">No tasks yet.</div>}
      {error && <div className="paid-no small">{error}</div>}
      <form
        className="inline-form no-print"
        style={{ marginTop: 4 }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add task…"
          aria-label="Add task"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-sm" disabled={pending || !title.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
