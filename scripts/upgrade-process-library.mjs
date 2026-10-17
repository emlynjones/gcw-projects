import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

// Run before db push on existing installations. The additive SQL avoids a
// Project table rebuild and is atomic; a fresh database is handled by db push.
const db = new PrismaClient();
try {
  const tables = await db.$queryRaw`SELECT name FROM sqlite_master WHERE type = 'table'`;
  if (!tables.some(t => t.name === "Project")) {
    console.log("[processes] Fresh database; schema sync will create the library.");
  } else {
    const columns = await db.$queryRawUnsafe('PRAGMA table_info("Project")');
    const names = ["WorkType", "ProcessTemplate", "ProcessRevision", "ProcessItem", "ProcessItemRevision", "ProcessItemDependency", "ProcessRule", "ProcessApplication", "AppliedProcessItem", "ProcessDismissal", "ProcessChange"];
    const installed = names.filter(name => tables.some(t => t.name === name));
    if (columns.some(c => c.name === "workTypeId") && installed.length === names.length) {
      console.log("[processes] Library schema already installed.");
    } else {
      if (installed.length || columns.some(c => c.name === "workTypeId"))
        throw new Error("Partial process-library schema found; inspect before continuing.");
      const sql = await readFile(new URL("../prisma/upgrades/20261017_process_library.sql", import.meta.url), "utf8");
      await db.$transaction(async tx => {
        for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean))
          await tx.$executeRawUnsafe(statement);
        const violations = await tx.$queryRawUnsafe("PRAGMA foreign_key_check");
        if (violations.length) throw new Error("Foreign-key check failed; process-library upgrade rolled back.");
      });
      console.log("[processes] Library upgrade complete; existing projects and tasks preserved.");
    }
  }
} finally { await db.$disconnect(); }
