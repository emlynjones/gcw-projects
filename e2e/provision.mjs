import { execSync } from "child_process";
import { existsSync, rmSync, mkdirSync, openSync, closeSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Prepares a fresh, isolated test database before the e2e server starts:
 * drops any previous test DB, applies the schema, and seeds fixtures.
 * DATABASE_URL is provided by Playwright's webServer.env and always points at
 * the throwaway e2e DB.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("[e2e] refusing to provision: DATABASE_URL must be a file: URL, got", url);
  process.exit(1);
}
const dbFile = url.replace(/^file:/, "");
const expected = path.join(__dirname, ".test-data", "e2e.db");
if (path.resolve(dbFile) !== expected) {
  throw new Error("Refusing to reset a database outside the dedicated e2e fixture path.");
}

console.log("[e2e] provisioning test DB at", dbFile);
for (const f of [dbFile, `${dbFile}-journal`, `${dbFile}-wal`, `${dbFile}-shm`]) {
  if (existsSync(f)) rmSync(f);
}
mkdirSync(path.dirname(dbFile), { recursive: true });
// Initialise the file explicitly: some Prisma/SQLite engine builds report an
// opaque schema error when db push receives a nonexistent SQLite file.
closeSync(openSync(dbFile, "wx"));

execSync("npx prisma db push --skip-generate", { cwd: ROOT, stdio: "inherit", env: process.env });

const { seed } = await import("./fixtures/seed.mjs");
await seed();
console.log("[e2e] test DB seeded");
