import { test as setup, expect } from "@playwright/test";
import { ADMIN, STORAGE_STATE } from "../test-env";

// Logs in once via credentials and saves the session for all other specs.
setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".topbar")).toContainText("Dashboard");
  await page.context().storageState({ path: STORAGE_STATE });
});
