import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

/**
 * File storage on the data volume. In production the compose file mounts
 * /data, so uploads persist under /data/uploads. Falls back to ./data/uploads
 * in local dev.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR || (process.env.NODE_ENV === "production" ? "/data/uploads" : "./data/uploads");

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

/** Persist an uploaded file under <uploads>/<projectId>/ and return its stored path (relative to UPLOADS_DIR). */
export async function saveUpload(projectId: string, file: File): Promise<{ path: string; size: number; mime: string; filename: string }> {
  if (file.size > MAX_BYTES) throw new Error("File too large (max 20 MB)");
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(UPLOADS_DIR, projectId);
  await mkdir(dir, { recursive: true });
  const rel = path.join(projectId, `${randomBytes(6).toString("hex")}-${safeName(file.name || "file")}`);
  await writeFile(path.join(UPLOADS_DIR, rel), buf);
  return { path: rel, size: file.size, mime: file.type || "application/octet-stream", filename: file.name || "file" };
}

export async function readUpload(relPath: string): Promise<Buffer> {
  // Guard against traversal — resolved path must stay within UPLOADS_DIR.
  const abs = path.resolve(UPLOADS_DIR, relPath);
  if (!abs.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) throw new Error("Invalid path");
  return readFile(abs);
}

export async function deleteUpload(relPath: string): Promise<void> {
  try {
    const abs = path.resolve(UPLOADS_DIR, relPath);
    if (!abs.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) return;
    await unlink(abs);
  } catch {
    // already gone — fine
  }
}
