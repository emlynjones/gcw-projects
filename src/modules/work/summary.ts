import { plainTextSummary } from "../summaries/domain";

export type TaskSummaryInput = {
  title: string;
  status: string;
  notes: { body: string }[];
};

/** Client-ready plain text generated from task facts, with no invented work. */
export function taskProgressSummary(projectTitle: string, tasks: TaskSummaryInput[]) {
  const completed = tasks.filter((task) => task.status === "DONE");
  const underway = tasks.filter((task) => task.status === "IN_PROGRESS");
  const blocked = tasks.filter((task) => task.status === "BLOCKED");
  const item = (task: TaskSummaryInput) => {
    const detail = task.notes.map((note) => note.body.trim()).filter(Boolean).join("; ");
    return detail ? `${task.title}: ${detail}` : task.title;
  };
  return plainTextSummary({
    title: `${projectTitle} — work summary`,
    sections: [
      { heading: "Completed", items: completed.map(item) },
      { heading: "In progress", items: underway.map(item) },
      { heading: "Blocked / awaiting input", items: blocked.map(item) },
    ],
  });
}
