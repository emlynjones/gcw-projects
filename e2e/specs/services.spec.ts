import { test, expect } from "@playwright/test";
import { createProject } from "../helpers";

test.describe("project services", () => {
  test("add a custom service line and remove one", async ({ page }) => {
    await createProject(page, { type: "PROJECT", client: "Beta Co", title: "Services Test", value: 1500 });
    const card = page.locator(".card", { hasText: "Services (for final invoice)" });

    // Defaults present.
    await expect(card).toContainText("Standard hosting");
    await expect(card).toContainText("Domain name");

    // Add a custom line.
    const custom = card.locator("form", { hasText: "Or custom line" });
    await custom.locator('input[name="name"]').fill("Extra page");
    await custom.locator('input[name="price"]').fill("95");
    await custom.getByRole("button", { name: "Add" }).click();
    await expect(card.locator('input[value="Extra page"]')).toBeVisible();

    // Remove the domain line. Service names live in editable inputs, so match
    // the row by its input value rather than visible text.
    const domainRow = card.locator("tr", { has: page.locator('input[value="Domain name"]') });
    await domainRow.getByRole("button", { name: "Remove" }).click();
    await expect(card.locator('input[value="Domain name"]')).toHaveCount(0);
  });
});
