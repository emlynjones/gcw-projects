# E2E tests (Playwright)

End-to-end regression tests, fully isolated from live code and data.

## Run

```bash
npm run test:e2e          # headless, all specs
npm run test:e2e:ui       # interactive UI mode
npm run test:e2e:report   # open the last HTML report
```

Everything is self-contained — no manual setup. On each run Playwright:

1. **Provisions a throwaway DB** (`e2e/provision.mjs`): drops any previous test
   DB, applies the Prisma schema, and seeds fixtures (`e2e/fixtures/seed.mjs`).
   The DB lives at `e2e/.test-data/e2e.db` and is **never** the live `/data` DB.
2. **Starts the app** with `next dev` on port **3100** using an explicit test
   environment (test `DATABASE_URL`, test `AUTH_SECRET`, placeholder Entra
   issuer). These override anything in `.env`, so real secrets/Xero are not used.
3. **Logs in once** (`auth.setup.ts`) and shares the session via `storageState`.
4. Runs the specs in `e2e/specs/`.

## Layout

```
e2e/
  playwright.config.ts   # isolated config (own port, test DB, webServer)
  test-env.ts            # shared constants (port, DB path, admin creds)
  provision.mjs          # reset + push + seed the test DB (pre-server)
  fixtures/seed.mjs      # deterministic seed data
  helpers.ts             # pickClient(), createProject()
  specs/
    auth.setup.ts        # login → storageState (dependency of the rest)
    smoke.spec.ts        # pages load, nav, seeded data
    projects.spec.ts     # create project/ad-hoc, stage advance (+ regression)
    invoices.spec.ts     # add invoice, change role via Save
    services.spec.ts     # default hosting/domain, add/remove lines
    settings.spec.ts     # AI panel renders
```

## Isolation guarantees

- Separate directory, separate `tsconfig.json`, excluded from the app build
  (`tsconfig.json` → `exclude: ["e2e"]`).
- `@playwright/test` is a dev dependency only; the Docker image sets
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so browsers are never fetched at build.
- Generated artefacts (`.test-data/`, `.auth/`, `playwright-report/`,
  `test-results/`) are git-ignored.

## Adding tests

Reuse `helpers.ts`. Prefer role/text selectors and Playwright's auto-waiting
(`expect(...).toHaveURL`, `toBeVisible`) over fixed `waitForTimeout` — the dev
server compiles routes lazily on first hit, so fixed sleeps are flaky.

## First-time setup on a new machine

Browsers must be present once: `npx playwright install chromium`.
On Linux you may also need `npx playwright install-deps chromium` (needs sudo).
