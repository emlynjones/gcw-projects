import { test, expect } from "@playwright/test";
import { createProject } from "../helpers";

test.describe("invoices", () => {
  test("add a manual invoice and change its role via Save", async ({ page }) => {
    const id = await createProject(page, { type: "PROJECT", client: "Beta Co", title: "Invoice Test", value: 2000 });

    // Open the Add invoice modal and record a manual invoice.
    await page.getByRole("link", { name: "+ Add invoice" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    const manual = modal.locator("form", { hasText: "Reference" }).last();
    await manual.locator('input[name="reference"]').fill("INV-E2E-1");
    await manual.locator('input[name="amount"]').fill("500");
    await manual.getByRole("button", { name: "Add" }).click();

    // The modal stays open after adding; reload the project page to see the table.
    await page.goto(`/projects/${id}`);
    const invRow = page.locator("table tr", { hasText: "INV-E2E-1" });
    await expect(invRow).toBeVisible();

    // Change the role using the clear Save button (regression for the subtle ✓).
    await invRow.locator('select[name="kind"]').selectOption("DEPOSIT");
    await invRow.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("table tr", { hasText: "INV-E2E-1" }).locator('select[name="kind"]')).toHaveValue(
      "DEPOSIT"
    );
  });
});
