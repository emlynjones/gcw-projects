import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../helpers";
import { TEST_DATABASE_URL } from "../test-env";

/**
 * Ad-hoc jobs bill as general or technical website work — not as WDD, which is
 * the design-and-build fee and what this used to send for everything.
 *
 * The picker is asserted, not the raise: submitting would call the real Xero
 * API. `adhocItemCode()` is what turns the choice into the line, and it falls
 * back to GWW for anything unrecognised.
 */

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

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

test.describe("ad-hoc item code", () => {
  test("offers general/technical work and defaults to general hourly", async ({ page }) => {
    const id = await createProject(page, {
      type: "ADHOC",
      client: "Beta Co",
      title: "Fix contact form",
      value: 240,
    });

    // The CTA banner only offers the invoice once the job is done. Set the
    // stage directly rather than clicking through the whole ad-hoc track.
    await prisma.project.update({ where: { id }, data: { stage: "DONE" } });
    await page.goto(`/projects/${id}`);

    const picker = page.locator('select[name="itemCode"]').first();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveValue("GWW");
    await expect(picker.locator("option")).toHaveText([
      "General website work (hourly)",
      "Technical website work (hourly)",
      "General website work (day rate)",
      "Technical website work (day rate)",
    ]);

    // Technical work is selectable, and survives into the submitted form.
    await picker.selectOption("TWW");
    await expect(picker).toHaveValue("TWW");
  });
});
