import { Prisma, type ProcessItemRevision } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { isStageFor } from "../../lib/status";
import { assertAcyclic } from "./domain";
import {
  applyProcessInput, processDraft, processFields, processDiff, processRule, ruleMatches,
  validateProcessGraph, FIELD_NAMES, type ProcessFields,
} from "./process-domain";

const revisionInclude = {
  items: { include: { dependencies: true }, orderBy: { position: "asc" as const } },
  rules: true, author: { select: { name: true } },
};
const applicationInclude = {
  revision: { select: { name: true, number: true } },
  items: { include: { task: { include: { dependencies: true } } } },
  changes: { include: { actor: { select: { name: true } }, revision: { select: { number: true } } }, orderBy: { createdAt: "desc" as const }, take: 20 },
};

export function itemFields(item: ProcessItemRevision & { dependencies: { prerequisiteId: string }[] }): ProcessFields {
  return processFields.parse({ ...item, dependencyIds: item.dependencies.map(d => d.prerequisiteId) });
}

export async function getProcessLibrary() {
  const [templates, workTypes] = await Promise.all([
    prisma.processTemplate.findMany({ include: {
      revisions: { include: revisionInclude, orderBy: { number: "desc" } },
      _count: { select: { applications: true } },
    }, orderBy: { createdAt: "asc" } }),
    prisma.workType.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { templates, workTypes };
}

export async function saveProcessDraft(input: unknown, actorId: string, publish = false) {
  const draft = processDraft.parse(input);
  validateProcessGraph(draft.items);
  if (publish && !draft.items.length) throw new Error("Add at least one task before publishing.");
  for (const rule of draft.rules) {
    if (rule.stage && !(rule.projectType ? isStageFor(rule.projectType, rule.stage) :
      isStageFor("PROJECT", rule.stage) || isStageFor("ADHOC", rule.stage)))
      throw new Error("Choose a stage valid for the selected project type.");
  }
  return prisma.$transaction(async tx => {
    const workTypeIds = [...new Set(draft.rules.flatMap(r => r.workTypeId ? [r.workTypeId] : []))];
    if (await tx.workType.count({ where: { id: { in: workTypeIds }, archived: false } }) !== workTypeIds.length)
      throw new Error("Choose an active work type.");
    const template = draft.templateId ? await tx.processTemplate.findUniqueOrThrow({ where: { id: draft.templateId } }) :
      await tx.processTemplate.create({ data: {} });
    if (template.archived) throw new Error("Restore this group before editing it.");
    if (!(await tx.processTemplate.updateMany({ where: { id: template.id, editVersion: draft.editVersion }, data: { editVersion: { increment: 1 } } })).count)
      throw new Error("Someone edited this template. Reload before saving.");
    const ownedItems = await tx.processItem.findMany({ where: { id: { in: draft.items.map(i => i.itemId) } } });
    if (ownedItems.some(i => i.templateId !== template.id)) throw new Error("A task belongs to another template.");
    for (const item of draft.items) if (!ownedItems.some(i => i.id === item.itemId))
      await tx.processItem.create({ data: { id: item.itemId, templateId: template.id } });
    // Only unpublished drafts may be replaced. Published content is never edited.
    await tx.processRevision.deleteMany({ where: { templateId: template.id, publishedAt: null } });
    const latest = await tx.processRevision.aggregate({ where: { templateId: template.id }, _max: { number: true } });
    const revision = await tx.processRevision.create({ data: {
      templateId: template.id, number: (latest._max.number ?? 0) + 1,
      name: draft.name, description: draft.description, changeSummary: draft.changeSummary,
      authorId: actorId, publishedAt: publish ? new Date() : null,
      rules: { create: draft.rules },
    } });
    for (const [position, item] of draft.items.entries()) {
      const { itemId, dependencyIds, ...fields } = item;
      await tx.processItemRevision.create({ data: {
        ...fields, itemId, position, revisionId: revision.id,
        dependencies: { create: [...new Set(dependencyIds)].map(prerequisiteId => ({ prerequisiteId })) },
      } });
    }
    return template.id;
  });
}

export async function archiveProcess(templateId: string, editVersion: number, archived: boolean) {
  if (!(await prisma.processTemplate.updateMany({ where: { id: templateId, editVersion }, data: { archived, editVersion: { increment: 1 } } })).count)
    throw new Error("Someone edited this template. Reload before saving.");
}

export async function saveWorkType(input: unknown) {
  const value = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100), archived: z.boolean() }).parse(input);
  return value.id ? prisma.workType.update({ where: { id: value.id }, data: { name: value.name, archived: value.archived } }) :
    prisma.workType.create({ data: { name: value.name } });
}

export async function setProjectWorkType(projectId: string, workTypeId: string | null) {
  return prisma.$transaction(async tx => {
    await activeProject(tx, projectId);
    if (workTypeId && !await tx.workType.findFirst({ where: { id: workTypeId, archived: false } }))
      throw new Error("Choose an active work type.");
    await tx.project.update({ where: { id: projectId }, data: { workTypeId } });
  });
}

async function activeProject(tx: Prisma.TransactionClient, projectId: string) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.archived) throw new Error("Choose an existing, unarchived project or job.");
  return project;
}

export async function applyProcess(input: unknown, actorId: string) {
  const value = applyProcessInput.parse(input);
  validateProcessGraph(value.items);
  return prisma.$transaction(async tx => {
    await activeProject(tx, value.projectId);
    const revision = await tx.processRevision.findUniqueOrThrow({ where: { id: value.revisionId }, include: { ...revisionInclude, template: true } });
    if (!revision.publishedAt || revision.template.archived) throw new Error("Choose a published, active template.");
    const existing = await tx.processApplication.findUnique({ where: { projectId_templateId_occurrence: {
      projectId: value.projectId, templateId: revision.templateId, occurrence: value.occurrence,
    } } });
    if (existing) return { id: existing.id, created: 0, alreadyApplied: true };
    if (value.items.some(i => !revision.items.some(source => source.itemId === i.itemId)))
      throw new Error("A selected task does not belong to this template revision.");
    const assignees = [...new Set(value.items.flatMap(i => i.assigneeId ? [i.assigneeId] : []))];
    if (await tx.user.count({ where: { id: { in: assignees }, role: { in: ["admin", "staff"] } } }) !== assignees.length)
      throw new Error("Choose a staff member.");
    const application = await tx.processApplication.create({ data: {
      projectId: value.projectId, templateId: revision.templateId, revisionId: revision.id, occurrence: value.occurrence,
    } });
    const taskIds = new Map<string, string>();
    for (const item of value.items) {
      const { itemId, dependencyIds: _dependencies, ...fields } = item;
      const task = await tx.task.create({ data: { ...fields, projectId: value.projectId } });
      taskIds.set(itemId, task.id);
      await tx.appliedProcessItem.create({ data: { applicationId: application.id, itemId, taskId: task.id,
        baseline: itemFields(revision.items.find(i => i.itemId === itemId)!) as Prisma.InputJsonValue,
      } });
    }
    for (const item of value.items) for (const prerequisiteId of new Set(item.dependencyIds))
      await tx.taskDependency.create({ data: { taskId: taskIds.get(item.itemId)!, prerequisiteId: taskIds.get(prerequisiteId)! } });
    await tx.processChange.create({ data: { applicationId: application.id, revisionId: revision.id, actorId,
      decisions: { kind: "APPLY", items: value.items.map(i => i.itemId) },
    } });
    return { id: application.id, created: value.items.length, alreadyApplied: false };
  });
}

export async function dismissProcess(projectId: string, templateId: string) {
  return prisma.$transaction(async tx => {
    await activeProject(tx, projectId);
    await tx.processTemplate.findUniqueOrThrow({ where: { id: templateId } });
    await tx.processDismissal.upsert({ where: { projectId_templateId: { projectId, templateId } }, update: {}, create: { projectId, templateId } });
  });
}

export async function getProjectProcesses(projectId: string) {
  const [project, library, applications, dismissals, people] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }), getProcessLibrary(),
    prisma.processApplication.findMany({ where: { projectId }, include: applicationInclude, orderBy: { createdAt: "asc" } }),
    prisma.processDismissal.findMany({ where: { projectId } }),
    prisma.user.findMany({ where: { role: { in: ["admin", "staff"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const templates = library.templates.filter(t => !t.archived).flatMap(t => {
    const revision = t.revisions.find(r => r.publishedAt);
    return revision ? [{ id: t.id, revisionId: revision.id, number: revision.number, name: revision.name,
      description: revision.description, items: revision.items.map(i => ({ itemId: i.itemId, ...itemFields(i) })),
      suggested: revision.rules.some(r => ruleMatches(processRule.parse(r), project)) && !dismissals.some(d => d.templateId === t.id) && !applications.some(a => a.templateId === t.id),
    }] : [];
  });
  return {
    workTypeId: project.workTypeId, archived: project.archived, workTypes: library.workTypes, templates, people,
    applications: applications.map(a => {
      const next = library.templates.find(t => t.id === a.templateId && !t.archived)?.revisions.find(r => r.publishedAt);
      const linkedIds = new Map(a.items.filter(i => i.taskId).map(i => [i.taskId!, i.itemId]));
      return { id: a.id, templateId: a.templateId, version: a.version, name: a.revision.name, number: a.revision.number,
        latestRevisionId: next?.id ?? a.revisionId, latestNumber: next?.number ?? a.revision.number,
        items: next?.items.map(source => {
          const applied = a.items.find(i => i.itemId === source.itemId);
          const fields = itemFields(source);
          const task = applied?.task;
          const baseline = applied ? processFields.parse(applied.baseline) : null;
          const current = task ? processFields.parse({ ...task, dependencyIds: task.dependencies.map(d => linkedIds.get(d.prerequisiteId) ?? `external:${d.prerequisiteId}`) }) : null;
          return { itemId: source.itemId, title: source.title, fields,
            taskId: task?.id ?? null, taskVersion: task?.version ?? null,
            deleted: !!applied && !task, done: task?.status === "DONE",
            diffs: baseline && current ? processDiff(baseline, current, fields) : [],
          };
        }) ?? [],
        removed: a.items.filter(i => next && !next.items.some(source => source.itemId === i.itemId)).map(i => i.task?.title ?? "Deleted task"),
        history: a.changes.map(c => {
          const event = z.object({ kind: z.enum(["APPLY", "UPDATE"]), items: z.array(z.string()).optional(), additions: z.array(z.string()).optional(), choices: z.array(z.object({ itemId: z.string(), title: z.string(), field: z.enum(FIELD_NAMES), choice: z.enum(["accept", "keep"]) })).optional() }).parse(c.decisions);
          return { id: c.id, actor: c.actor.name, number: c.revision.number, at: c.createdAt.toISOString(),
            summary: event.kind === "APPLY" ? `Created ${event.items?.length ?? 0} tasks` : `Added ${event.additions?.length ?? 0} tasks; reviewed ${event.choices?.length ?? 0} fields`,
            choices: event.choices ?? [],
          };
        }),
      };
    }),
  };
}

const updateInput = z.object({
  projectId: z.string(), applicationId: z.string(), revisionId: z.string(), version: z.number().int().min(0),
  additions: z.array(z.string()).max(200),
  choices: z.array(z.object({ itemId: z.string(), taskVersion: z.number().int(), field: z.enum(FIELD_NAMES), choice: z.enum(["accept", "keep"]) })).max(1600),
});

export async function updateAppliedProcess(input: unknown, actorId: string) {
  const value = updateInput.parse(input);
  if (!value.choices.length && !value.additions.length) throw new Error("Choose at least one change.");
  return prisma.$transaction(async tx => {
    await activeProject(tx, value.projectId);
    const application = await tx.processApplication.findUniqueOrThrow({ where: { id: value.applicationId }, include: applicationInclude });
    if (application.projectId !== value.projectId) throw new Error("This process belongs to another project.");
    const revision = await tx.processRevision.findUniqueOrThrow({ where: { id: value.revisionId }, include: { ...revisionInclude, template: true } });
    if (revision.templateId !== application.templateId || !revision.publishedAt || revision.template.archived)
      throw new Error("Choose a published, active revision of this process.");
    const latest = await tx.processRevision.findFirst({ where: { templateId: application.templateId, publishedAt: { not: null } }, orderBy: { number: "desc" } });
    if (latest?.id !== revision.id) throw new Error("A newer version was published. Reload before reviewing updates.");
    if (revision.number < application.revision.number) throw new Error("Choose the current or a newer revision.");
    if (!(await tx.processApplication.updateMany({ where: { id: application.id, version: value.version }, data: { version: { increment: 1 } } })).count)
      throw new Error("This process application changed. Reload before reviewing again.");
    const taskIds = new Map(application.items.filter(i => i.taskId).map(i => [i.itemId, i.taskId!]));
    const tasks = await tx.task.findMany({ where: { projectId: value.projectId }, include: { dependencies: true } });
    const baselineUpdates = new Map<string, ProcessFields>();
    const patches = new Map<string, Record<string, unknown>>();
    const dependencyUpdates = new Map<string, string[]>();
    const expectedVersions = new Map<string, number>();
    const additions = [...new Set(value.additions)];
    for (const itemId of additions) {
      const source = revision.items.find(i => i.itemId === itemId);
      if (!source || application.items.some(i => i.itemId === itemId)) throw new Error("Only new template tasks can be added; deleted project tasks stay deleted.");
      const fields = itemFields(source);
      const { dependencyIds: _deps, ...data } = fields;
      const task = await tx.task.create({ data: { ...data, projectId: value.projectId } });
      taskIds.set(itemId, task.id);
      tasks.push({ ...task, dependencies: [] });
      dependencyUpdates.set(task.id, fields.dependencyIds);
      await tx.appliedProcessItem.create({ data: { applicationId: application.id, itemId, taskId: task.id, baseline: fields as Prisma.InputJsonValue } });
    }
    const decisionKeys = new Set<string>();
    for (const choice of value.choices) {
      const key = `${choice.itemId}:${choice.field}`;
      if (decisionKeys.has(key)) throw new Error("Review each field only once.");
      decisionKeys.add(key);
      const applied = application.items.find(i => i.itemId === choice.itemId);
      const source = revision.items.find(i => i.itemId === choice.itemId);
      if (!applied?.task || !source) throw new Error("This task is no longer available for update.");
      if (applied.task.version !== choice.taskVersion) throw new Error("A task changed. Reload before reviewing again.");
      const previous = expectedVersions.get(applied.task.id);
      if (previous !== undefined && previous !== choice.taskVersion) throw new Error("Task version mismatch.");
      expectedVersions.set(applied.task.id, choice.taskVersion);
      const next = itemFields(source);
      const baseline = baselineUpdates.get(applied.id) ?? processFields.parse(applied.baseline);
      // Each reviewed field advances its own baseline, including explicit keep-local decisions.
      Object.assign(baseline, { [choice.field]: next[choice.field] });
      baselineUpdates.set(applied.id, baseline);
      if (choice.choice === "accept") {
        if (choice.field === "dependencyIds") dependencyUpdates.set(applied.task.id, next.dependencyIds);
        else patches.set(applied.task.id, { ...patches.get(applied.task.id), [choice.field]: next[choice.field] });
      }
    }
    const edges = await tx.taskDependency.findMany({ where: { task: { projectId: value.projectId } } });
    const resolvedDependencies = new Map<string, string[]>();
    for (const [taskId, itemIds] of dependencyUpdates) {
      const dependencies = itemIds.map(itemId => {
        const id = taskIds.get(itemId);
        if (!id) throw new Error("Include the new prerequisite tasks before accepting these dependencies.");
        return id;
      });
      resolvedDependencies.set(taskId, dependencies);
    }
    const proposedEdges = edges.filter(e => !resolvedDependencies.has(e.taskId)).concat(
      [...resolvedDependencies].flatMap(([taskId, ids]) => ids.map(prerequisiteId => ({ taskId, prerequisiteId }))),
    );
    for (const [taskId, ids] of resolvedDependencies) {
      assertAcyclic(taskId, ids, proposedEdges);
      if (tasks.find(t => t.id === taskId)?.status === "DONE" && ids.some(id => tasks.find(t => t.id === id)?.status !== "DONE"))
        throw new Error("Completed tasks cannot depend on unfinished tasks.");
      await tx.taskDependency.deleteMany({ where: { taskId } });
      for (const prerequisiteId of new Set(ids)) await tx.taskDependency.create({ data: { taskId, prerequisiteId } });
    }
    for (const [taskId, version] of expectedVersions) {
      if (!(await tx.task.updateMany({ where: { id: taskId, projectId: value.projectId, version }, data: { ...patches.get(taskId), version: { increment: 1 } } })).count)
        throw new Error("A task changed. Reload before reviewing again.");
    }
    for (const [id, baseline] of baselineUpdates)
      await tx.appliedProcessItem.update({ where: { id }, data: { baseline: baseline as Prisma.InputJsonValue } });
    await tx.processChange.create({ data: { applicationId: application.id, revisionId: revision.id, actorId,
      decisions: { kind: "UPDATE", additions, choices: value.choices.map(choice => ({ ...choice, title: revision.items.find(i => i.itemId === choice.itemId)!.title })) },
    } });
    return { added: additions.length, reviewed: value.choices.length };
  });
}
