import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

// Additive, retry-safe upgrade for existing databases. Existing planned dates
// intentionally remain unallocated rather than guessing an AM/PM period.
const db = new PrismaClient();
try {
  const tables = await db.$queryRaw`SELECT name FROM sqlite_master WHERE type = 'table'`;
  if (!tables.some((table) => table.name === "Task")) {
    console.log("[task-planning] Fresh database; schema sync will create planned periods.");
  } else {
    const columns = await db.$queryRawUnsafe('PRAGMA table_info("Task")');
    if (columns.some((column) => column.name === "plannedPeriod")) {
      console.log("[task-planning] Planned periods already installed.");
    } else {
      const sql = await readFile(
        new URL("../prisma/upgrades/20261124_task_planned_period.sql", import.meta.url),
        "utf8",
      );
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql.trim());
        const violations = await tx.$queryRawUnsafe("PRAGMA foreign_key_check");
        if (violations.length) throw new Error("Foreign-key check failed; task-planning upgrade rolled back.");
      });
      console.log("[task-planning] Planned periods added; existing tasks remain unallocated.");
    }
  }
} finally {
  await db.$disconnect();
}
