import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "src", "app");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    })
  );
  return files.flat();
}

const actionFiles = (await filesUnder(root)).filter((path) => /actions\.tsx?$/.test(path));
const violations = [];

for (const path of actionFiles) {
  const source = await readFile(path, "utf8");
  const imports = source.matchAll(/from\s+["']@\/app\/[^"']*actions["']/g);
  for (const match of imports) {
    violations.push(`${relative(process.cwd(), path)}: ${match[0]}`);
  }
}

if (violations.length) {
  console.error("Server-action modules must not import other server-action modules.");
  console.error("Move shared operations into src/modules and import them from both adapters.\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Boundary check passed (${actionFiles.length} action modules checked).`);
