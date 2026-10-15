import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "../test-env";
import {
  assertAcyclic,
  monday,
  taskInput,
  weeklyLoad,
} from "../../src/modules/work/domain";

test("date validation, dependency cycles and weekly load", () => {
  expect(monday("2026-10-25")).toBe("2026-10-19");
  expect(monday("2026-03-29")).toBe("2026-03-23");
  expect(() => monday("2026-02-30")).toThrow();
  expect(() =>
    assertAcyclic("a", ["b"], [{ taskId: "b", prerequisiteId: "a" }]),
  ).toThrow(/cycle/);
  expect(() => assertAcyclic("a", ["a"], [])).toThrow();
  expect(() =>
    assertAcyclic("a", ["b"], [{ taskId: "b", prerequisiteId: "c" }]),
  ).not.toThrow();
  const task = {
    assigneeId: "staff",
    status: "TODO",
    estimatedHours: 3,
    plannedDate: "2026-10-19",
  };
  expect(
    weeklyLoad(
      [
        task,
        { ...task, status: "DONE", estimatedHours: 2 },
        { ...task, estimatedHours: null },
        { ...task, plannedDate: "2026-10-26" },
        { ...task, assigneeId: null },
      ],
      "staff",
      "2026-10-19",
    ),
  ).toEqual({ hours: 5, missing: 1, count: 3 });
});

test("task application preserves relationships, dependencies and concurrent edits", async () => {
  // Explicit test DB before importing the application singleton. Never use .env.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const { saveTask } = await import("../../src/modules/work/application");
  const db = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });
  const client = await db.client.create({
    data: { name: "Task rules fixture" },
  });
  const project = await db.project.create({
    data: { title: "Task rules project", clientId: client.id },
  });
  const job = await db.project.create({
    data: { title: "Task rules ad hoc", clientId: client.id, type: "ADHOC" },
  });
  const base = {
    projectId: project.id,
    title: "Prerequisite",
    description: "",
    assigneeId: "",
    status: "TODO",
    priority: "NORMAL",
    estimatedHours: "",
    plannedDate: "",
    dueDate: "",
    completionCriteria: "",
    sopUrl: "",
    dependencyIds: [] as string[],
  };
  try {
    expect(taskInput.safeParse({ ...base, estimatedHours: "-1" }).success).toBe(
      false,
    );
    expect(
      taskInput.safeParse({ ...base, sopUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    const a = await saveTask(base);
    const b = await saveTask({
      ...base,
      title: "Dependent",
      dependencyIds: [a.id],
    });
    await expect(
      saveTask({ ...base, id: a.id, dependencyIds: [b.id] }),
    ).rejects.toThrow(/cycle/);
    await expect(
      saveTask({ ...base, projectId: job.id, dependencyIds: [a.id] }),
    ).rejects.toThrow(/same project/);
    await expect(
      saveTask({ ...base, id: b.id, status: "DONE", dependencyIds: [a.id] }),
    ).rejects.toThrow(/prerequisite/);
    await expect(saveTask({ ...base, assigneeId: "unknown" })).rejects.toThrow(
      /staff member/,
    );
    await saveTask({ ...base, id: a.id, status: "DONE" });
    await expect(saveTask({ ...base, id: a.id, version: 0 })).rejects.toThrow(
      /Someone changed/,
    );
    await saveTask({
      ...base,
      id: b.id,
      status: "DONE",
      dependencyIds: [a.id],
    });
    await expect(saveTask({ ...base, id: a.id, version: 1 })).rejects.toThrow(
      /Reopen completed/,
    );
    await expect(
      saveTask({ ...base, id: a.id, projectId: job.id }),
    ).rejects.toThrow(/does not belong/);
    const adhoc = await saveTask({ ...base, projectId: job.id });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: adhoc.id } })).projectId,
    ).toBe(job.id);
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: project.id } })).stage,
    ).toBe("ENQUIRY");
    await db.project.delete({ where: { id: project.id } });
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.taskDependency.count({ where: { taskId: b.id } })).toBe(0);
  } finally {
    await db.project.deleteMany({ where: { clientId: client.id } });
    await db.client.delete({ where: { id: client.id } });
    await db.$disconnect();
  }
});
