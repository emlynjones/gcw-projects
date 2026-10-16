import { prisma } from "../../lib/prisma";
import {
  assertAcyclic,
  dateOnly,
  monday,
  parseTaskLines,
  taskInput,
  taskRowPatch,
} from "./domain";
import { z } from "zod";

export async function saveTask(input: unknown) {
  const { id, version, dependencyIds, ...fields } = taskInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: fields.projectId },
    });
    if (!project || project.archived)
      throw new Error("Choose an existing, unarchived project or job.");
    if (
      fields.assigneeId &&
      !(await tx.user.findFirst({
        where: { id: fields.assigneeId, role: { in: ["admin", "staff"] } },
      }))
    )
      throw new Error("Choose a staff member.");
    const before = id ? await tx.task.findUnique({ where: { id } }) : null;
    if (id && (!before || before.projectId !== fields.projectId))
      throw new Error("Task does not belong to this project.");
    const prerequisites = await tx.task.findMany({
      where: { id: { in: [...new Set(dependencyIds)] } },
    });
    if (
      prerequisites.length !== new Set(dependencyIds).size ||
      prerequisites.some((task) => task.projectId !== fields.projectId)
    )
      throw new Error("Dependencies must belong to the same project or job.");
    if (
      fields.status === "DONE" &&
      prerequisites.some((task) => task.status !== "DONE")
    )
      throw new Error(
        "Complete the prerequisite tasks before marking this task done.",
      );
    if (id) {
      assertAcyclic(
        id,
        dependencyIds,
        await tx.taskDependency.findMany({
          where: { task: { projectId: fields.projectId } },
        }),
      );
      if (
        before?.status === "DONE" &&
        fields.status !== "DONE" &&
        (await tx.taskDependency.count({
          where: { prerequisiteId: id, task: { status: "DONE" } },
        }))
      )
        throw new Error("Reopen completed dependent tasks first.");
    }
    const completedAt =
      fields.status === "DONE" ? (before?.completedAt ?? new Date()) : null;
    let taskId = id;
    if (taskId) {
      const changed = await tx.task.updateMany({
        where: { id: taskId, version },
        data: { ...fields, completedAt, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new Error(
          "Someone changed this task. Reload the page before saving again.",
        );
      await tx.taskDependency.deleteMany({ where: { taskId } });
    } else {
      taskId = (await tx.task.create({ data: { ...fields, completedAt } })).id;
    }
    for (const prerequisiteId of new Set(dependencyIds))
      await tx.taskDependency.create({ data: { taskId, prerequisiteId } });
    return {
      id: taskId,
      projectId: fields.projectId,
      version: id ? version + 1 : 0,
    };
  });
}

// Inline edits from the task table go through saveTask so the assignee,
// version, prerequisite and reopen rules cannot drift from the full editor.
export async function updateTaskRow(input: {
  id: string;
  version: number;
  patch: unknown;
}) {
  const patch = taskRowPatch.parse(input.patch);
  const task = await prisma.task.findUnique({
    where: { id: input.id },
    include: { dependencies: true },
  });
  if (!task) throw new Error("This task no longer exists. Reload the page.");
  return saveTask({
    projectId: task.projectId,
    description: task.description,
    title: patch.title ?? task.title,
    status: patch.status ?? task.status,
    assigneeId:
      patch.assigneeId !== undefined
        ? (patch.assigneeId ?? "")
        : (task.assigneeId ?? ""),
    dueDate:
      patch.dueDate !== undefined ? (patch.dueDate ?? "") : (task.dueDate ?? ""),
    priority: task.priority,
    estimatedHours: task.estimatedHours ?? "",
    plannedDate: task.plannedDate ?? "",
    completionCriteria: task.completionCriteria,
    sopUrl: task.sopUrl ?? "",
    isMilestone: task.isMilestone,
    dependencyIds: task.dependencies.map((edge) => edge.prerequisiteId),
    id: task.id,
    version: input.version,
  });
}

export async function deleteTask(input: {
  id: string;
  projectId: string;
  version: number;
}) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: input.id },
      include: { project: { select: { archived: true } } },
    });
    if (!task || task.projectId !== input.projectId)
      throw new Error("Task does not belong to this project.");
    if (task.project.archived)
      throw new Error("Archived projects cannot be changed.");
    const dependents = await tx.taskDependency.findMany({
      where: { prerequisiteId: input.id },
      include: { task: { select: { title: true } } },
    });
    if (dependents.length)
      throw new Error(
        `Remove this task from the dependencies of: ${dependents
          .map((edge) => edge.task.title)
          .join(", ")}.`,
      );
    const removed = await tx.task.deleteMany({
      where: { id: input.id, version: input.version },
    });
    if (!removed.count)
      throw new Error(
        "Someone changed this task. Reload the page before deleting it.",
      );
    return { projectId: task.projectId };
  });
}

// Explicit, retry-safe conversion: the description is read server-side and
// titles already present on the project are skipped. The description itself
// is left untouched for the user to tidy.
export async function createTasksFromDetails(projectId: string) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { description: true, archived: true },
    });
    if (!project || project.archived)
      throw new Error("Choose an existing, unarchived project or job.");
    const existing = new Set(
      (
        await tx.task.findMany({
          where: { projectId },
          select: { title: true },
        })
      ).map((task) => task.title.trim().toLowerCase()),
    );
    const titles = parseTaskLines(project.description);
    const fresh = titles.filter((title) => !existing.has(title.toLowerCase()));
    for (const title of fresh)
      await tx.task.create({ data: { projectId, title } });
    return { created: fresh.length, skipped: titles.length - fresh.length };
  });
}

export async function saveCapacity(input: unknown) {
  const value = z
    .object({
      userId: z.string().min(1),
      weekStart: dateOnly,
      hours: z
        .union([z.number(), z.string().trim().min(1, "Enter available hours")])
        .pipe(z.coerce.number().finite().min(0).max(168)),
    })
    .parse(input);
  if (monday(value.weekStart) !== value.weekStart)
    throw new Error("Capacity must start on a Monday.");
  if (
    !(await prisma.user.findFirst({
      where: { id: value.userId, role: { in: ["admin", "staff"] } },
    }))
  )
    throw new Error("Staff member not found.");
  return prisma.staffWeekCapacity.upsert({
    where: {
      userId_weekStart: { userId: value.userId, weekStart: value.weekStart },
    },
    create: value,
    update: { hours: value.hours },
  });
}

export async function getWorkData(projectId?: string) {
  const [tasks, projects, people, capacities] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...(projectId ? { projectId } : { project: { archived: false } }),
      },
      include: { dependencies: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.project.findMany({
      where: projectId ? { id: projectId } : { archived: false },
      select: { id: true, title: true, type: true, archived: true },
      orderBy: { title: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["admin", "staff"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffWeekCapacity.findMany(),
  ]);
  return {
    tasks: tasks.map(
      ({ createdAt, updatedAt, completedAt, dependencies, ...task }) => ({
        ...task,
        dependencyIds: dependencies.map((edge) => edge.prerequisiteId),
      }),
    ),
    projects,
    people,
    capacities,
  };
}
export type WorkData = Awaited<ReturnType<typeof getWorkData>>;
