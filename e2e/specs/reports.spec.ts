import { test, expect } from "@playwright/test";

test.describe("reports", () => {
  test("weekly report renders its sections", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Weekly report" })).toBeVisible();
    // Ad-hoc to-do list is always present (even if empty).
    await expect(page.getByRole("heading", { name: "Ad-hoc — to do" })).toBeVisible();
    // Projects-by-stage section header.
    await expect(page.getByRole("heading", { name: "Projects by stage" }).first()).toBeVisible();
    // Print control available.
    await expect(page.getByRole("button", { name: "Print report" })).toBeVisible();
  });
});
