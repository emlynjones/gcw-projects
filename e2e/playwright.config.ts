import { defineConfig, devices } from "@playwright/test";
import {
  ROOT,
  TEST_PORT,
  BASE_URL,
  TEST_DATABASE_URL,
  TEST_AUTH_SECRET,
  STORAGE_STATE,
} from "./test-env";

/**
 * E2E config, fully isolated from live code and data:
 *  - runs the app on a dedicated port against a throwaway seeded SQLite DB
 *  - explicit test env overrides real secrets; empty Entra vars match prod
 *    (avoids the NextAuth "Configuration" error) while credentials login works
 *  - a `setup` project logs in once and shares the session via storageState
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: {
    command: `node e2e/provision.mjs && npx next dev -p ${TEST_PORT}`,
    cwd: ROOT,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_URL: BASE_URL,
      // The Entra provider is always registered; it just needs a valid-format
      // issuer to initialise (we only ever log in via credentials in tests).
      AUTH_MICROSOFT_ENTRA_ID_ID: "e2e",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "e2e",
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/common/v2.0",
      ALLOWED_EMAIL_DOMAIN: "",
    },
  },
});
