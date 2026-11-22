"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkData } from "@/modules/work/application";
import { addTaskNoteAction } from "./actions";

type Task = WorkData["tasks"][number];

export default function TaskNotes({ task, locked }: { task: Task; locked: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="task-notes">
      <h3>Progress notes</h3>
      {task.notes.length ? (
        <ol>
          {task.notes.map((note) => (
            <li key={note.id}>
              <div>{note.body}</div>
              <small className="muted">
                {note.authorName} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(note.createdAt))}
              </small>
            </li>
          ))}
        </ol>
      ) : <p className="muted small">No progress notes yet.</p>}
      {!locked && (
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim() || pending) return;
          setPending(true);
          setError("");
          const result = await addTaskNoteAction(task.id, body);
          setPending(false);
          if (result.error) return setError(result.error);
          setBody("");
          router.refresh();
        }}>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={10000} placeholder="What was done, decided or discovered?" />
          <button className="btn btn-secondary btn-sm" disabled={pending || !body.trim()}>{pending ? "Adding…" : "Add note"}</button>
          {error && <span role="alert" className="work-warning small">{error}</span>}
        </form>
      )}
    </section>
  );
}
