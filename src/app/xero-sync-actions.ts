"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getItems, scopeIsCurrent, getConnection } from "@/lib/xero";
import { syncClientInvoiceLines } from "@/modules/accounting/xero/invoice-lines";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

/**
 * Clients per run. Xero allows 60 calls/minute and we make 1–2 per client, so a
 * batch of 12 (≈15s with the delay below) stays far inside both that limit and
 * any reverse-proxy request timeout. The Settings page drives repeat batches
 * until the cursor is exhausted.
 */
const BATCH_SIZE = 12;
const CALL_DELAY_MS = 900;

const SYNC_CURSOR_KEY = "xeroSyncCursor";
const SYNC_DONE_KEY = "xeroLinesSyncedAt";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cursor = { startedAt: string; doneClientIds: string[] };

export type SyncResult = {
  clientsScanned: number;
  invoices: number;
  lines: number;
  domainsFound: number;
  remaining: number;
  errors: string[];
};

async function readCursor(): Promise<Cursor | null> {
  const row = await prisma.setting.findUnique({ where: { key: SYNC_CURSOR_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Cursor;
    return Array.isArray(parsed.doneClientIds) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCursor(cursor: Cursor | null) {
  if (!cursor) {
    await prisma.setting.deleteMany({ where: { key: SYNC_CURSOR_KEY } });
    return;
  }
  const value = JSON.stringify(cursor);
  await prisma.setting.upsert({
    where: { key: SYNC_CURSOR_KEY },
    update: { value },
    create: { key: SYNC_CURSOR_KEY, value },
  });
}

/** How many linked clients are still awaiting a scan in the current run. */
/**
 * Drop a half-finished batch scan.
 *
 * The scan is largely obsolete now the CSV import loads the whole ledger in one
 * go, but an abandoned run leaves a cursor behind that reports "24 of 227" on
 * Settings forever. Clearing the cursor discards only the bookmark — every
 * invoice line already fetched stays cached.
 */
export async function abandonInvoiceScan(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SYNC_CURSOR_KEY } });
  revalidatePath("/settings");
}

export async function syncProgress(): Promise<{ done: number; total: number; inProgress: boolean }> {
  const total = await prisma.client.count({ where: { xeroContactId: { not: null } } });
  const cursor = await readCursor();
  return { done: cursor?.doneClientIds.length ?? 0, total, inProgress: !!cursor };
}

/**
 * Pull one batch of clients' Xero invoice lines into the local cache, extracting
 * the domains mentioned in each. This cache is the ground truth for "who has been
 * billed for what" — it drives both import matching and already-billed detection.
 *
 * Idempotent: rows are keyed on (xeroInvoiceId, lineIndex), so re-running
 * refreshes in place rather than duplicating. Resumable via a cursor in Setting,
 * so a large client base is scanned across several short requests.
 */
export async function syncXeroInvoiceLines(restart = false): Promise<SyncResult> {
  await requireUser();

  const result: SyncResult = {
    clientsScanned: 0,
    invoices: 0,
    lines: 0,
    domainsFound: 0,
    remaining: 0,
    errors: [],
  };

  const conn = await getConnection();
  if (!conn) {
    result.errors.push("Xero is not connected.");
    return result;
  }

  let cursor = (restart ? null : await readCursor()) ?? {
    startedAt: new Date().toISOString(),
    doneClientIds: [],
  };

  const done = new Set(cursor.doneClientIds);
  const pending = (
    await prisma.client.findMany({
      where: { xeroContactId: { not: null } },
      select: { id: true, name: true, xeroContactId: true },
      orderBy: { name: "asc" },
    })
  ).filter((c) => !done.has(c.id));

  const batch = pending.slice(0, BATCH_SIZE);
  const allDomains = new Set<string>();

  for (const client of batch) {
    try {
      const one = await syncClientInvoiceLines(client.id, client.xeroContactId!);
      result.invoices += one.invoices;
      result.lines += one.lines;
      one.domains.forEach((d) => allDomains.add(d));
    } catch (e) {
      // Mark as done regardless — a permanently failing client must not wedge
      // the whole run; the error is surfaced instead.
      result.errors.push(`${client.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    done.add(client.id);
    result.clientsScanned++;
    await sleep(CALL_DELAY_MS);
  }

  result.domainsFound = allDomains.size;
  result.remaining = pending.length - batch.length;

  cursor = { startedAt: cursor.startedAt, doneClientIds: [...done] };
  if (result.remaining > 0) {
    await writeCursor(cursor);
  } else {
    await writeCursor(null);
    await prisma.setting.upsert({
      where: { key: SYNC_DONE_KEY },
      update: { value: new Date().toISOString() },
      create: { key: SYNC_DONE_KEY, value: new Date().toISOString() },
    });
  }

  revalidatePath("/settings");
  revalidatePath("/recurring/billed");
  return result;
}

/** Settings form wrapper — runs one batch and reports the outcome via the URL. */
export async function syncXeroInvoiceLinesAction(formData: FormData): Promise<void> {
  const r = await syncXeroInvoiceLines(formData.get("restart") === "1");
  const params = new URLSearchParams({
    synced: "1",
    clients: String(r.clientsScanned),
    invoices: String(r.invoices),
    lines: String(r.lines),
    domains: String(r.domainsFound),
    remaining: String(r.remaining),
  });
  if (r.errors.length) params.set("syncErrors", r.errors.slice(0, 3).join(" | "));
  redirect(`/settings?${params.toString()}`);
}

/** Probe used by Settings to confirm a reconnect actually granted Items access. */
export async function checkXeroItems(): Promise<{ ok: boolean; count: number; error?: string }> {
  await requireUser();
  const conn = await getConnection();
  if (!conn) return { ok: false, count: 0, error: "Xero is not connected." };
  if (!scopeIsCurrent(conn.scope)) {
    return { ok: false, count: 0, error: "Reconnect Xero to grant the products scope." };
  }
  try {
    const items = await getItems();
    return { ok: true, count: items.length };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
