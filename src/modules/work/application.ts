import { prisma } from "../../lib/prisma";
import { assertAcyclic, dateOnly, monday, taskInput } from "./domain";
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
    return { id: taskId, projectId: fields.projectId };
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
