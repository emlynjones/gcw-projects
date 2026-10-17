import { z } from "zod";
import { assertAcyclic, dateOnly, PRIORITIES } from "./domain";

export const processFields = z.object({
  title: z.string().trim().min(1, "Enter a task title").max(200),
  description: z.string().trim().max(20000).default(""),
  completionCriteria: z.string().trim().max(10000).default(""),
  sopUrl: z.union([z.literal(""), z.string().url().regex(/^https?:\/\//i)]).nullable().transform(v => v || null),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  estimatedHours: z.number().finite().min(0).max(10000).nullable(),
  isMilestone: z.boolean().default(false),
  dependencyIds: z.array(z.string().min(1)).max(200).default([]),
});
export type ProcessFields = z.infer<typeof processFields>;
export const FIELD_NAMES = ["title", "description", "completionCriteria", "sopUrl", "priority", "estimatedHours", "isMilestone", "dependencyIds"] as const;
export type ProcessField = typeof FIELD_NAMES[number];
export const FIELD_LABELS: Record<ProcessField, string> = {
  title: "Title", description: "Instructions", completionCriteria: "Acceptance criteria",
  sopUrl: "SOP link", priority: "Priority", estimatedHours: "Estimated hours",
  isMilestone: "Milestone", dependencyIds: "Prerequisites",
};
export const processRule = z.object({
  projectType: z.enum(["PROJECT", "ADHOC"]).nullable(),
  stage: z.string().max(100).nullable(),
  workTypeId: z.string().min(1).nullable(),
});
export const processDraft = z.object({
  templateId: z.string().optional(),
  editVersion: z.number().int().min(0),
  name: z.string().trim().min(1, "Enter a group name").max(200),
  description: z.string().trim().max(10000),
  changeSummary: z.string().trim().max(2000),
  items: z.array(processFields.extend({ itemId: z.string().min(1).max(100) })).max(200),
  rules: z.array(processRule).max(30),
});
export type ProcessDraft = z.infer<typeof processDraft>;
export const applyProcessInput = z.object({
  projectId: z.string().min(1), revisionId: z.string().min(1),
  occurrence: z.union([z.literal("primary"), z.string().uuid()]),
  items: z.array(processFields.extend({
    itemId: z.string().min(1),
    assigneeId: z.string().min(1).nullable(),
    dueDate: dateOnly.nullable(), plannedDate: dateOnly.nullable(),
  })).min(1, "Select at least one task").max(200),
});
export type ApplyProcessInput = z.infer<typeof applyProcessInput>;

export function validateProcessGraph(items: { itemId: string; dependencyIds: string[] }[]) {
  const ids = new Set(items.map(i => i.itemId));
  if (ids.size !== items.length) throw new Error("Task identities must be unique.");
  const edges = items.flatMap(i => i.dependencyIds.map(prerequisiteId => ({ taskId: i.itemId, prerequisiteId })));
  if (edges.some(e => !ids.has(e.prerequisiteId)))
    throw new Error("Include each prerequisite, or remove that dependency before applying.");
  for (const item of items) assertAcyclic(item.itemId, item.dependencyIds, edges);
}

export function sameProcessValue(a: unknown, b: unknown): boolean {
  // Prerequisite order is not meaningful.
  return JSON.stringify(Array.isArray(a) ? [...a].sort() : a) ===
    JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
}

export function processDiff(baseline: ProcessFields, current: ProcessFields, next: ProcessFields) {
  return FIELD_NAMES.filter(field => !sameProcessValue(baseline[field], next[field])).map(field => ({
    field, before: baseline[field], current: current[field], next: next[field],
    conflict: !sameProcessValue(baseline[field], current[field]),
  }));
}

export function ruleMatches(rule: z.infer<typeof processRule>, project: { type: string; stage: string; workTypeId: string | null }) {
  return (!rule.projectType || rule.projectType === project.type) &&
    (!rule.stage || rule.stage === project.stage) &&
    (!rule.workTypeId || rule.workTypeId === project.workTypeId);
}
