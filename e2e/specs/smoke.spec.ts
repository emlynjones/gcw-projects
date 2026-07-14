import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  test("dashboard loads with nav", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    for (const link of ["Dashboard", "Projects", "Clients", "Reports", "Settings"]) {
      await expect(page.locator(".topbar nav").getByRole("link", { name: link })).toBeVisible();
    }
  });

  test("key pages render", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Weekly report" })).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("seeded data is present", async ({ page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Acme Ltd" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta Co" })).toBeVisible();
  });
});
