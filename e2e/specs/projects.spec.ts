import { test, expect } from "@playwright/test";
import { createProject } from "../helpers";

test.describe("projects", () => {
  test("create a full project (gets standard services)", async ({ page }) => {
    await createProject(page, { type: "PROJECT", client: "Beta Co", title: "Beta New Site", value: 2500 });
    await expect(page.getByRole("heading", { name: "Beta New Site" })).toBeVisible();
    // Standard hosting + domain added by default.
    const services = page.locator(".card", { hasText: "Services (for final invoice)" });
    await expect(services).toContainText("Standard hosting");
    await expect(services).toContainText("Domain name");
  });

  test("regression: create ad-hoc for a client that already has a project", async ({ page }) => {
    // Acme Ltd is seeded with an existing project — this used to fail.
    const id = await createProject(page, {
      type: "ADHOC",
      client: "Acme Ltd",
      title: "Acme quick fix",
      value: 150,
    });
    expect(id).toMatch(/^c[a-z0-9]{10,}$/);
    await expect(page.getByRole("heading", { name: "Acme quick fix" })).toBeVisible();
    await expect(page.locator(".badge-type")).toContainText("Ad-hoc");
  });

  test("advance a project's stage", async ({ page }) => {
    await createProject(page, { type: "PROJECT", client: "Beta Co", title: "Stage Test", value: 1000 });
    // New full project starts at Enquiry; the next-action button advances it.
    await expect(page.locator(".badge-stage")).toContainText("Enquiry");
    await page.getByRole("button", { name: /Mark quoted/i }).click();
    await expect(page.locator(".badge-stage")).toContainText("Quoted");
  });
});
