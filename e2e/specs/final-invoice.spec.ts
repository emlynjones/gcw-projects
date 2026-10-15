import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../helpers";
import { TEST_DATABASE_URL } from "../test-env";

/**
 * The closing-invoice panel: additional services PLUS the balance of the agreed
 * fee left after the deposit. The regression it guards is billing the services
 * alone — a £6,950 project with a £2,085 deposit and £500 of services used to
 * close at £500, silently dropping the £4,865 balance.
 *
 * Note full projects are created with standard hosting (£120) + domain (£15)
 * already attached, so £135 of services is the baseline, not zero.
 *
 * The panel only renders when Xero is connected, so a dummy connection row is
 * written to the throwaway test DB. Nothing here submits the form: that would
 * call the real Xero API. The preview total is the contract under test, and the
 * server action bills from the same helpers (lib/invoicing.ts).
 */

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const panelOf = (page: Page) => page.locator("form", { hasText: "Invoice total (ex-VAT)" }).first();

/** Record an invoice against the project through the manual (non-Xero) form. */
async function recordInvoice(page: Page, reference: string, amount: string) {
  await page.getByRole("link", { name: "+ Add invoice" }).click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  const manual = modal.locator("form", { hasText: "Reference" }).last();
  await manual.locator('input[name="reference"]').fill(reference);
  await manual.locator('input[name="amount"]').fill(amount);
  await manual.getByRole("button", { name: "Add" }).click();
}

/** Strip the default hosting/domain lines so a project genuinely has no services. */
async function clearServices(page: Page, id: string) {
  for (let i = 0; i < 10; i++) {
    await page.goto(`/projects/${id}`);
    const remove = page.getByRole("button", { name: "Remove" });
    if ((await remove.count()) === 0) return;
    await remove.first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
  }
  throw new Error("services still attached after 10 removals");
}

test.beforeAll(async () => {
  await prisma.xeroConnection.upsert({
    where: { id: "xero" },
    update: { expiresAt: new Date(Date.now() + 3_600_000) },
    create: {
      id: "xero",
      tenantId: "e2e-tenant",
      tenantName: "E2E Org",
      accessToken: "e2e-not-a-real-token",
      refreshToken: "e2e-not-a-real-token",
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: "accounting.transactions",
    },
  });
});

test.afterAll(async () => {
  await prisma.xeroConnection.deleteMany({ where: { id: "xero" } });
  await prisma.$disconnect();
});

test.describe("closing invoice", () => {
  test("bills additional services plus the remaining balance", async ({ page }) => {
    const id = await createProject(page, {
      type: "PROJECT",
      client: "Beta Co",
      title: "Closing Invoice Test",
      value: 6950,
    });

    // A 30% deposit, recorded manually so the test needs no Xero round-trip.
    await recordInvoice(page, "INV-DEPOSIT", "2085");

    // An extra agreed mid-project, on top of the quoted fee.
    await page.goto(`/projects/${id}`);
    const custom = page.locator("form", { hasText: "Or custom line" });
    await custom.locator('input[name="name"]').fill("Extra landing page");
    await custom.locator('input[name="price"]').fill("365");
    await custom.getByRole("button", { name: "Add" }).click();

    // The action re-renders the page in place — wait for the new line to land
    // before asserting, rather than navigating out from under the submission.
    const panel = panelOf(page);
    await expect(panel).toContainText("Additional services (3 lines)");

    // Balance = 6950 - 2085; services = 120 + 15 + 365; both on one invoice.
    await expect(panel).toContainText("£4,865");
    await expect(panel).toContainText("£500");
    const raise = panel.getByRole("button", { name: /^Raise/ });
    await expect(raise).toHaveText("Raise £5,365 invoice (DRAFT in Xero)");

    // Either part can be dropped, and the button always names what it will bill.
    await panel.locator('input[name="includeServices"]').uncheck();
    await expect(raise).toHaveText("Raise £4,865 invoice (DRAFT in Xero)");

    await panel.locator('input[name="includeServices"]').check();
    await panel.locator('input[name="includeRemainder"]').uncheck();
    await expect(raise).toHaveText("Raise £500 invoice (DRAFT in Xero)");

    // Nothing selected is not a raiseable invoice.
    await panel.locator('input[name="includeServices"]').uncheck();
    await expect(raise).toBeDisabled();
  });

  test("offers the balance on a project with no services attached", async ({ page }) => {
    const id = await createProject(page, {
      type: "PROJECT",
      client: "Beta Co",
      title: "Balance Only Test",
      value: 5165,
    });
    await recordInvoice(page, "INV-DEP-2", "1549.50");
    await clearServices(page, id);

    const panel = panelOf(page);
    await expect(panel.getByRole("button", { name: /^Raise/ })).toHaveText(
      "Raise £3,615.5 invoice (DRAFT in Xero)"
    );
    // No services to bill, so that half of the panel is inert.
    await expect(panel.locator('input[name="includeServices"]')).toBeDisabled();
  });

  test("says so when the fee is fully invoiced and nothing is outstanding", async ({ page }) => {
    const id = await createProject(page, {
      type: "PROJECT",
      client: "Beta Co",
      title: "Fully Invoiced Test",
      value: 1000,
    });
    await recordInvoice(page, "INV-FULL", "1000");
    await clearServices(page, id);

    await expect(page.getByText("Nothing left to invoice")).toBeVisible();
  });
});
