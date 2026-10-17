import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TEST_DATABASE_URL, ROOT } from "../test-env";
import { processDiff, ruleMatches, validateProcessGraph, type ProcessDraft, type ProcessFields } from "../../src/modules/work/process-domain";

const fields = (title: string): ProcessFields => ({ title, description: "Original instructions", completionCriteria: "Checked", sopUrl: "https://example.com/sop", estimatedHours: 1, priority: "NORMAL", isMilestone: false, dependencyIds: [] });

test("process dependency validation, matching and field conflict detection", () => {
  expect(() => validateProcessGraph([{ itemId: "a", dependencyIds: ["missing"] }])).toThrow(/prerequisite/);
  expect(() => validateProcessGraph([{ itemId: "a", dependencyIds: ["b"] }, { itemId: "b", dependencyIds: ["a"] }])).toThrow(/cycle/);
  expect(() => validateProcessGraph([{ itemId: "a", dependencyIds: [] }, { itemId: "a", dependencyIds: [] }])).toThrow(/unique/);
  const baseline = fields("Original");
  expect(processDiff(baseline, { ...baseline, title: "Local" }, { ...baseline, title: "New", description: "New description" })).toEqual([
    expect.objectContaining({ field: "title", conflict: true, current: "Local" }),
    expect.objectContaining({ field: "description", conflict: false }),
  ]);
  expect(processDiff({ ...baseline, dependencyIds: ["a", "b"] }, baseline, { ...baseline, dependencyIds: ["b", "a"] })).toHaveLength(0);
  const rule = { projectType: "ADHOC" as const, stage: "DOING", workTypeId: "migration" };
  expect(ruleMatches(rule, { type: "ADHOC", stage: "DOING", workTypeId: "migration" })).toBe(true);
  expect(ruleMatches(rule, { type: "PROJECT", stage: "DOING", workTypeId: "migration" })).toBe(false);
});

test("additive upgrade preserves legacy rows and is safe to run twice", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(path.join(tmpdir(), "gcw-process-upgrade-"));
  const filename = path.join(directory, "legacy.db");
  let db = new DatabaseSync(filename);
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE User (id TEXT PRIMARY KEY);
      CREATE TABLE Project (id TEXT PRIMARY KEY, title TEXT, stage TEXT, totalValue REAL);
      CREATE TABLE Task (id TEXT PRIMARY KEY, projectId TEXT REFERENCES Project(id), title TEXT, status TEXT);
      INSERT INTO User VALUES ('staff');
      INSERT INTO Project VALUES ('project', 'Existing project', 'GO_LIVE', 1234.56);
      INSERT INTO Task VALUES ('task', 'project', 'Existing task', 'DONE');`);
    db.close();
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, ["scripts/upgrade-process-library.mjs"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${filename}` } });
    db = new DatabaseSync(filename);
    expect(db.prepare("SELECT * FROM Project").get()).toEqual({ id: "project", title: "Existing project", stage: "GO_LIVE", totalValue: 1234.56, workTypeId: null });
    expect(db.prepare("SELECT * FROM Task").get()).toEqual({ id: "task", projectId: "project", title: "Existing task", status: "DONE" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare('PRAGMA index_list("Project")').all().map(index => index.name)).toContain("Project_workTypeId_idx");
    const sql = readFileSync(path.join(ROOT, "prisma/upgrades/20261017_process_library.sql"), "utf8");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE "Project"/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("published templates apply to both job types and merge reviewed updates safely", async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const { saveProcessDraft, applyProcess, getProjectProcesses, updateAppliedProcess, setProjectWorkType, dismissProcess, archiveProcess } = await import("../../src/modules/work/processes");
  const db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  const actor = await db.user.findUniqueOrThrow({ where: { email: "test@example.com" } });
  const client = await db.client.create({ data: { name: "Process rule fixtures" } });
  const project = await db.project.create({ data: { title: "Process rule project", clientId: client.id, stage: "ONBOARDING" } });
  const job = await db.project.create({ data: { title: "Process rule job", clientId: client.id, type: "ADHOC", stage: "DOING" } });
  const type = await db.workType.create({ data: { name: "Process rule work type" } });
  const a = { ...fields("Collect access"), itemId: randomUUID() };
  const b = { ...fields("Review access"), itemId: randomUUID(), dependencyIds: [a.itemId] };
  const c = { ...fields("Confirm handover"), itemId: randomUUID(), dependencyIds: [b.itemId] };
  let draft: ProcessDraft = { name: "Process rule template", description: "Fixtures", changeSummary: "Initial", editVersion: 0, items: [a, b], rules: [{ projectType: "PROJECT", stage: "ONBOARDING", workTypeId: type.id }] };
  try {
    const templateId = await saveProcessDraft(draft, actor.id);
    let template = await db.processTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { revisions: true } });
    await expect(applyProcess({ projectId: project.id, revisionId: template.revisions[0].id, occurrence: "primary", items: [{ ...a, assigneeId: null, plannedDate: null, dueDate: null }] }, actor.id)).rejects.toThrow(/published/);
    await expect(saveProcessDraft({ ...draft, templateId }, actor.id, true)).rejects.toThrow(/Someone edited/);
    draft = { ...draft, templateId, editVersion: 1 };
    await saveProcessDraft(draft, actor.id, true);
    const v1 = await db.processRevision.findUniqueOrThrow({ where: { templateId_number: { templateId, number: 1 } } });
    await setProjectWorkType(project.id, type.id);
    expect((await getProjectProcesses(project.id)).templates.find(t => t.id === templateId)?.suggested).toBe(true);
    await dismissProcess(project.id, templateId);
    await db.project.update({ where: { id: project.id }, data: { stage: "ENQUIRY" } });
    await db.project.update({ where: { id: project.id }, data: { stage: "ONBOARDING" } });
    expect((await getProjectProcesses(project.id)).templates.find(t => t.id === templateId)?.suggested).toBe(false);
    const withPlanning = (items: typeof a[]) => items.map(item => ({ ...item, assigneeId: actor.id, plannedDate: "2026-10-19", dueDate: "2026-10-23" }));
    const payload = { projectId: project.id, revisionId: v1.id, occurrence: "primary", items: withPlanning([a, b]) };
    await expect(applyProcess({ ...payload, items: withPlanning([b]) }, actor.id)).rejects.toThrow(/prerequisite/);
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
    await expect(applyProcess({ ...payload, items: [{ ...withPlanning([a])[0], assigneeId: "not-staff" }] }, actor.id)).rejects.toThrow(/staff member/);
    const application = await applyProcess(payload, actor.id);
    expect(application.created).toBe(2);
    expect((await applyProcess(payload, actor.id)).alreadyApplied).toBe(true);
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(2);
    const jobApplication = await applyProcess({ ...payload, projectId: job.id, items: withPlanning([a]) }, actor.id);
    const copy = { ...payload, projectId: job.id, occurrence: randomUUID() };
    expect((await applyProcess(copy, actor.id)).created).toBe(2);
    expect((await applyProcess(copy, actor.id)).created).toBe(0);
    const appliedA = await db.appliedProcessItem.findUniqueOrThrow({ where: { applicationId_itemId: { applicationId: application.id, itemId: a.itemId } } });
    const local = await db.task.update({ where: { id: appliedA.taskId! }, data: { title: "Locally customised access", status: "DONE", completedAt: new Date(), version: { increment: 1 } } });
    expect((await applyProcess(payload, actor.id)).created).toBe(0);
    draft = { ...draft, editVersion: 2, changeSummary: "Clarify instructions", items: [{ ...a, title: "Collect credentials", description: "New instructions", priority: "HIGH" }, b, c] };
    await saveProcessDraft(draft, actor.id, true);
    const v2 = await db.processRevision.findUniqueOrThrow({ where: { templateId_number: { templateId, number: 2 } } });
    expect((await db.processItemRevision.findUniqueOrThrow({ where: { revisionId_itemId: { revisionId: v1.id, itemId: a.itemId } } })).title).toBe(a.title);
    let review = (await getProjectProcesses(project.id)).applications.find(app => app.id === application.id)!;
    expect(review.items.find(i => i.itemId === a.itemId)?.diffs.find(d => d.field === "title")?.conflict).toBe(true);
    expect(review.items.find(i => i.itemId === a.itemId)?.done).toBe(true);
    await expect(updateAppliedProcess({ projectId: job.id, applicationId: application.id, revisionId: v2.id, version: 0, additions: [], choices: [{ itemId: a.itemId, taskVersion: local.version, field: "title", choice: "keep" }] }, actor.id)).rejects.toThrow(/another project/);
    const jobUpdate = { projectId: job.id, applicationId: jobApplication.id, revisionId: v2.id, version: 0, additions: [c.itemId], choices: [] };
    await expect(updateAppliedProcess(jobUpdate, actor.id)).rejects.toThrow(/prerequisite/);
    expect((await db.processApplication.findUniqueOrThrow({ where: { id: jobApplication.id } })).version).toBe(0);
    const update = { projectId: project.id, applicationId: application.id, revisionId: v2.id, version: 0, additions: [c.itemId], choices: [
      { itemId: a.itemId, taskVersion: local.version, field: "title", choice: "keep" },
      { itemId: a.itemId, taskVersion: local.version, field: "description", choice: "accept" },
    ] };
    await updateAppliedProcess(update, actor.id);
    await expect(updateAppliedProcess(update, actor.id)).rejects.toThrow(/application changed/);
    const after = await db.task.findUniqueOrThrow({ where: { id: local.id } });
    expect(after).toMatchObject({ title: "Locally customised access", description: "New instructions", status: "DONE", priority: "NORMAL", assigneeId: actor.id, dueDate: "2026-10-23", plannedDate: "2026-10-19" });
    review = (await getProjectProcesses(project.id)).applications.find(app => app.id === application.id)!;
    expect(review.items.find(i => i.itemId === a.itemId)?.diffs.map(d => d.field)).toEqual(["priority"]);
    await expect(updateAppliedProcess({ ...update, version: 1, additions: [], choices: [{ itemId: a.itemId, taskVersion: local.version, field: "priority", choice: "accept" }] }, actor.id)).rejects.toThrow(/task changed/);
    const appliedC = await db.appliedProcessItem.findUniqueOrThrow({ where: { applicationId_itemId: { applicationId: application.id, itemId: c.itemId } } });
    await db.task.delete({ where: { id: appliedC.taskId! } });
    review = (await getProjectProcesses(project.id)).applications.find(app => app.id === application.id)!;
    expect(review.items.find(i => i.itemId === c.itemId)?.deleted).toBe(true);
    await expect(updateAppliedProcess({ ...update, version: 1, additions: [c.itemId], choices: [] }, actor.id)).rejects.toThrow(/deleted project tasks stay deleted/);
    expect(await db.processChange.count({ where: { applicationId: application.id } })).toBe(2);
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } }))).toMatchObject({ stage: "ONBOARDING", totalValue: 0 });
    // A valid new template graph can still form a cycle when only part of it is
    // applied to an existing project graph. Validate the final combined graph.
    draft = { ...draft, editVersion: 3, items: [{ ...draft.items[0], dependencyIds: [b.itemId] }, { ...b, dependencyIds: [] }] };
    await saveProcessDraft(draft, actor.id, true);
    const v3 = await db.processRevision.findUniqueOrThrow({ where: { templateId_number: { templateId, number: 3 } } });
    const appliedB = await db.appliedProcessItem.findUniqueOrThrow({ where: { applicationId_itemId: { applicationId: application.id, itemId: b.itemId } } });
    const bTask = await db.task.findUniqueOrThrow({ where: { id: appliedB.taskId! } });
    const dependencies = { projectId: project.id, applicationId: application.id, revisionId: v3.id, version: 1, additions: [], choices: [
      { itemId: a.itemId, taskVersion: after.version, field: "dependencyIds", choice: "accept" },
    ] };
    await expect(updateAppliedProcess(dependencies, actor.id)).rejects.toThrow(/cycle/);
    dependencies.choices.push({ itemId: b.itemId, taskVersion: bTask.version, field: "dependencyIds", choice: "accept" });
    await expect(updateAppliedProcess(dependencies, actor.id)).rejects.toThrow(/unfinished/);
    const doneB = await db.task.update({ where: { id: bTask.id }, data: { status: "DONE", completedAt: new Date(), version: { increment: 1 } } });
    dependencies.choices[1].taskVersion = doneB.version;
    await updateAppliedProcess(dependencies, actor.id);
    expect(await db.taskDependency.findMany({ where: { taskId: after.id } })).toEqual([{ taskId: after.id, prerequisiteId: bTask.id }]);
    expect((await db.task.findUniqueOrThrow({ where: { id: after.id } })).status).toBe("DONE");
    await expect(updateAppliedProcess({ ...update, version: 2 }, actor.id)).rejects.toThrow(/newer version/);
    draft = { ...draft, editVersion: 4, items: [{ ...draft.items[0], dependencyIds: [] }] };
    await saveProcessDraft(draft, actor.id, true);
    review = (await getProjectProcesses(project.id)).applications.find(app => app.id === application.id)!;
    expect(review.removed).toContain("Review access");
    expect(await db.task.findUnique({ where: { id: bTask.id } })).not.toBeNull();
    await db.project.update({ where: { id: job.id }, data: { archived: true } });
    await expect(applyProcess({ ...copy, occurrence: randomUUID() }, actor.id)).rejects.toThrow(/unarchived/);
    template = await db.processTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { revisions: true } });
    await archiveProcess(templateId, template.editVersion, true);
    await expect(applyProcess({ ...payload, occurrence: randomUUID() }, actor.id)).rejects.toThrow(/active template/);
    expect((await getProjectProcesses(project.id)).templates.some(t => t.id === templateId)).toBe(false);
  } finally {
    await db.project.deleteMany({ where: { clientId: client.id } });
    await db.client.delete({ where: { id: client.id } });
    await db.$disconnect();
  }
});
