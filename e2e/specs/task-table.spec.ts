import { test, expect } from "@playwright/test";
import { createProject } from "../helpers";

test("compact task table: add, inline edit, dependencies, delete guard, convert details", async ({
  page,
}) => {
  await createProject(page, {
    type: "ADHOC",
    client: "Acme Ltd",
    title: "Task table job",
  });
  const tasks = page.locator("#tasks");
  const rows = tasks.locator("tr.task-row");

  // Rapid entry: Enter adds and keeps the input ready for the next task.
  await tasks.getByRole("button", { name: "+ Add task" }).click();
  const name = tasks.getByLabel("New task name");
  for (const title of ["Write copy", "Publish page", "Check links"]) {
    await name.fill(title);
    await name.press("Enter");
    await expect(
      tasks.getByRole("textbox", { name: "Task name", exact: true }).last(),
    ).toHaveValue(title);
    await expect(name).toHaveValue("");
  }
  await expect(rows).toHaveCount(3);

  // Inline edits persist.
  const first = rows.nth(0);
  await first.getByLabel("Status").selectOption("IN_PROGRESS");
  await expect(first.getByLabel("Status")).toBeEnabled();
  await first.getByLabel("Assigned person").selectOption({ label: "Test Admin" });
  await expect(first.getByLabel("Assigned person")).toBeEnabled();
  await first.getByLabel("Due date").fill("2026-10-30");
  await expect(first.getByLabel("Due date")).toBeEnabled();
  await page.reload();
  await expect(rows.nth(0).getByLabel("Status")).toHaveValue("IN_PROGRESS");
  await expect(rows.nth(0).getByLabel("Assigned person")).not.toHaveValue("");
  await expect(rows.nth(0).getByLabel("Due date")).toHaveValue("2026-10-30");

  // Expanded details: estimate and a dependency on the first task.
  await rows.nth(1).getByRole("button", { name: /details for Publish page/ }).click();
  const editor = tasks.locator(".task-expanded");
  await editor.getByLabel("Estimated hours").fill("2");
  await editor.getByLabel("Write copy · In progress").check();
  await editor.getByRole("button", { name: "Save task" }).click();
  await expect(editor).toHaveCount(0);

  // The prerequisite rule surfaces inline and the cell reverts.
  await rows.nth(1).getByLabel("Status").selectOption("DONE");
  await expect(tasks.getByRole("alert")).toContainText("prerequisite");
  await expect(rows.nth(1).getByLabel("Status")).toHaveValue("TODO");

  // Delete is blocked while another task depends on it.
  await rows.nth(0).getByRole("button", { name: /details for Write copy/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await tasks.getByRole("button", { name: "Delete task" }).click();
  await expect(tasks.locator(".task-delete").getByRole("alert")).toContainText(
    "Publish page",
  );
  await expect(rows).toHaveCount(3);

  // Remove the dependency, then deletion succeeds.
  await rows.nth(1).getByRole("button", { name: /details for Publish page/ }).click();
  await tasks.locator(".task-expanded").last().getByLabel("Write copy · In progress").uncheck();
  await tasks.locator(".task-expanded").last().getByRole("button", { name: "Save task" }).click();
  await expect(tasks.locator(".task-expanded")).toHaveCount(0);
  await rows.nth(0).getByRole("button", { name: /details for Write copy/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await tasks.getByRole("button", { name: "Delete task" }).click();
  await expect(rows).toHaveCount(2);

  // Job details bullets convert once; a retry skips what already exists.
  const details = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "Job details" }) });
  await details
    .locator('textarea[name="description"]')
    .fill("Context paragraph\n- Publish page\n- Fix footer");
  await details.getByRole("button", { name: "Save details" }).click();
  await details.getByRole("button", { name: "Create 2 tasks from this list" }).click();
  await expect(details.getByRole("status")).toHaveText(
    "Created 1 task, skipped 1 already listed",
  );
  await expect(rows).toHaveCount(3);
  await details.getByRole("button", { name: "Create 2 tasks from this list" }).click();
  await expect(details.getByRole("status")).toHaveText(
    "Created 0 tasks, skipped 2 already listed",
  );
  await expect(rows).toHaveCount(3);
});
