import { test, expect } from "@playwright/test";

test("capture, plan and complete project tasks and milestones", async ({
  page,
}) => {
  await page.goto("/work?view=all");
  await expect(
    page.getByRole("heading", { name: "All Work", exact: true }),
  ).toBeVisible();
  const capture = page.getByRole("form", { name: "Quick add task" });
  await capture
    .getByLabel("Title", { exact: true })
    .fill("Work test: review design");
  await capture
    .getByLabel("Project or ad hoc job")
    .selectOption({ label: "Acme Website" });
  await capture
    .getByLabel("Assigned person")
    .selectOption({ label: "Test Admin" });
  await capture.getByLabel("Priority").selectOption("HIGH");
  await capture.getByText("Details, planning and dependencies").click();
  await capture.getByLabel("Estimated hours").fill("6");
  await capture.getByLabel("Planned date").fill("2026-10-19");
  await capture.getByLabel("Due date").fill("2026-10-23");
  await capture
    .getByLabel("Completion criteria")
    .fill("Client has reviewed the design");
  await capture
    .getByLabel("SOP or process link")
    .fill("https://example.com/design-process");
  await capture.getByLabel("Milestone", { exact: true }).check();
  await capture.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status")).toHaveText("Task saved");
  await expect(
    page.getByRole("button", { name: "Work test: review design" }),
  ).toBeVisible();

  await page.goto("/work");
  await expect(
    page.getByRole("button", { name: "Work test: review design" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Work test: review design" }).click();
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await editor
    .getByLabel("Description", { exact: true })
    .fill("Check every page");
  await editor
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("IN_PROGRESS");
  await editor.getByRole("button", { name: "Save task" }).click();
  await expect(editor).not.toBeVisible();
  await page.goto("/work?view=planner");
  await page.getByLabel("Week of").fill("2026-10-19");
  const staff = page
    .locator("section.card")
    .filter({
      has: page.getByRole("heading", { name: "Test Admin", exact: true }),
    });
  await staff.getByLabel("Available hours").fill("4");
  await staff.getByRole("button", { name: "Save capacity" }).click();
  await expect(
    staff.getByText("6h allocated / 4h available · 2h over capacity"),
  ).toBeVisible();
  await expect(
    staff.getByRole("button", { name: "Work test: review design" }),
  ).toBeVisible();

  await page.goto("/work?view=kanban");
  await page.getByRole("button", { name: "Work test: review design" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("DONE");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page
      .locator(".work-board > section")
      .filter({ has: page.getByRole("heading", { name: /^Done/ }) })
      .getByRole("button", { name: "Work test: review design" }),
  ).toBeVisible();
  await page
    .locator(".work-task")
    .filter({ hasText: "Work test: review design" })
    .getByRole("link", { name: "Acme Website" })
    .click();
  await expect(
    page.locator("#tasks").getByText("Milestones: 1 / 1 complete"),
  ).toBeVisible();
});

test("unauthenticated visitors cannot access work views", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto("/work");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
