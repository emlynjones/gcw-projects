import { z } from "zod";

export const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
export const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const STATUS_LABELS: Record<string, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid date");
const optionalDate = z
  .union([z.literal(""), dateOnly])
  .transform((value) => value || null);
const hours = z
  .union([z.literal(""), z.coerce.number().finite().min(0).max(10000)])
  .transform((value) => (value === "" ? null : value));
const taskTitle = z.string().trim().min(1, "Enter a title").max(200);
const taskAssignee = z.string().transform((value) => value || null);
export const taskInput = z.object({
  id: z.string().optional(),
  version: z.coerce.number().int().min(0).default(0),
  projectId: z.string().min(1, "Choose a project or ad hoc job"),
  title: taskTitle,
  description: z.string().trim().max(20000).default(""),
  assigneeId: taskAssignee,
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  estimatedHours: hours,
  dueDate: optionalDate,
  plannedDate: optionalDate,
  completionCriteria: z.string().trim().max(10000).default(""),
  sopUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .url()
        .refine(
          (value) => /^https?:\/\//i.test(value),
          "Use an HTTP or HTTPS link",
        ),
    ])
    .transform((value) => value || null),
  isMilestone: z.boolean().default(false),
  dependencyIds: z.array(z.string().min(1)).max(200).default([]),
});

// Fields editable inline from the compact task table.
export const taskRowPatch = z
  .object({
    title: taskTitle,
    status: z.enum(STATUSES),
    assigneeId: taskAssignee,
    dueDate: optionalDate,
  })
  .partial();

// Bullet/numbered/checkbox lines from free-text job details. Prose is ignored
// so a plain paragraph never turns into tasks by accident.
export function parseTaskLines(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*\u2022]|\[[ xX]?\]|\d+[.)])\s+(.+)$/);
    const title = match?.[1].replace(/^\[[ xX]?\]\s*/, "").trim().slice(0, 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    titles.push(title);
  }
  return titles;
}

export function todayLondon(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${dateOnly.parse(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function monday(date: string): string {
  const day = new Date(`${dateOnly.parse(date)}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
export function assertAcyclic(
  taskId: string,
  prerequisites: string[],
  edges: { taskId: string; prerequisiteId: string }[],
) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.taskId === taskId) continue;
    graph.set(edge.taskId, [
      ...(graph.get(edge.taskId) ?? []),
      edge.prerequisiteId,
    ]);
  }
  const visited = new Set<string>();
  const queue = [...prerequisites];
  while (queue.length) {
    const current = queue.pop()!;
    if (current === taskId)
      throw new Error(
        "Dependencies cannot form a cycle or refer to the task itself.",
      );
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(graph.get(current) ?? []));
  }
}

export type ScheduledWork = {
  assigneeId: string | null;
  plannedDate: string | null;
  estimatedHours: number | null;
  status: string;
};
export function weeklyLoad(
  tasks: ScheduledWork[],
  userId: string | null,
  weekStart: string,
) {
  const end = addDays(weekStart, 7);
  const scheduled = tasks.filter(
    (task) =>
      task.assigneeId === userId &&
      task.plannedDate &&
      task.plannedDate >= weekStart &&
      task.plannedDate < end,
  );
  return {
    hours: scheduled.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0),
    missing: scheduled.filter((task) => task.estimatedHours === null).length,
    count: scheduled.length,
  };
}
