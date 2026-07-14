import { test, expect } from "@playwright/test";

test.describe("settings", () => {
  test("AI panel renders and reports no key set", async ({ page }) => {
    await page.goto("/settings");
    const ai = page.locator(".card", { has: page.getByRole("heading", { name: "AI", exact: true }) });
    await expect(ai).toContainText("No API key set");
    await expect(ai.getByRole("button", { name: "Save AI settings" })).toBeVisible();
    // Provider choices are available.
    await expect(ai.locator('select[name="provider"]')).toBeVisible();
  });
});
