import { expect, type Page } from "@playwright/test";

/** Pick a client in the combined client picker (New Project / bulk forms). */
export async function pickClient(page: Page, name: string) {
  await page.locator(".client-picker input[type=text]").fill(name);
  await page.locator(".xero-search-results button", { hasText: name }).first().click();
  await expect(page.locator(".client-picker")).toContainText("Selected:");
}

/**
 * Create a project through the UI and return its URL id. Uses auto-waiting on
 * the resulting /projects/<cuid> navigation (robust against dev lazy-compile).
 */
export async function createProject(
  page: Page,
  opts: { type: "PROJECT" | "ADHOC"; client: string; title: string; value?: number }
): Promise<string> {
  await page.goto(`/projects/new?type=${opts.type}`);
  await pickClient(page, opts.client);
  await page.fill('input[name="title"]', opts.title);
  if (opts.value != null) await page.fill('input[name="totalValue"]', String(opts.value));
  const label = opts.type === "ADHOC" ? "Create ad-hoc job" : "Create project";
  await page.getByRole("button", { name: label }).click();
  await expect(page).toHaveURL(/\/projects\/c[a-z0-9]{10,}$/);
  return page.url().split("/").pop() as string;
}
