"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getInvoiceIndexPage, parseXeroDate, getConnection } from "@/lib/xero";
import { combineExports, type CombineSummary } from "@/lib/xero-csv";
import { nameKey } from "@/lib/websites";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

/**
 * Pages per run and the gap between calls. Xero allows 60 calls a minute; 20
 * pages at ~700ms is ~14 seconds, comfortably inside both that and any proxy
 * timeout, and covers 2,000 invoices a run. The Settings page drives repeats.
 */
const INDEX_PAGES_PER_RUN = 20;
/** Matches the invoice-line sync's pacing — 700ms lands too close to 60/min. */
const CALL_DELAY_MS = 900;
const INDEX_CURSOR_KEY = "xeroInvoiceIndexPage";
const INDEX_DONE_KEY = "xeroInvoiceIndexedAt";

/** Rows per write batch — see importInvoiceCsvs. */
const WRITE_CHUNK = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type IndexResult = {
  pagesFetched: number;
  invoices: number;
  nextPage: number | null;
  total: number;
  error?: string;
};

/**
 * Build (or extend) the invoice-number → GUID index.
 *
 * Resumable: the page cursor lives in Setting, so a ledger of any size is
 * covered by repeated short requests rather than one long one. Re-running from
 * scratch is safe — every row upserts on its number.
 */
export async function syncInvoiceIndex(restart = false): Promise<IndexResult> {
  await requireUser();

  const conn = await getConnection();
  if (!conn) {
    return { pagesFetched: 0, invoices: 0, nextPage: null, total: 0, error: "Xero is not connected." };
  }

  let page = 1;
  if (!restart) {
    const cursor = await prisma.setting.findUnique({ where: { key: INDEX_CURSOR_KEY } });
    const parsed = parseInt(cursor?.value ?? "1", 10);
    if (Number.isFinite(parsed) && parsed > 0) page = parsed;
  }

  let pagesFetched = 0;
  let invoices = 0;
  let exhausted = false;

  try {
    for (let i = 0; i < INDEX_PAGES_PER_RUN; i++) {
      const batch = await getInvoiceIndexPage(page);
      pagesFetched++;

      if (!batch.length) {
        exhausted = true;
        break;
      }

      // One transaction per page, not one per invoice.
      //
      // SQLite takes a single writer and commits with an fsync, so 100 separate
      // upserts is 100 exclusive locks in a tight loop. Done that way across a
      // few thousand invoices it starves every other query in the app: page
      // loads start failing with P1008 socket timeouts while the index runs.
      // Batching the page into one transaction turns 100 commits into one.
      const writes = [];
      for (const inv of batch) {
        const xeroNumber = (inv.InvoiceNumber ?? "").trim();
        // An invoice with no number can't be joined to a CSV row, and the CSV
        // drops those rows too — so there's nothing to index it against.
        if (!xeroNumber) continue;

        const data = {
          xeroInvoiceId: inv.InvoiceID,
          contactId: inv.Contact?.ContactID ?? "",
          contactName: inv.Contact?.Name ?? null,
          invoiceDate: parseXeroDate(inv.Date) ?? new Date(),
          status: inv.Status,
          syncedAt: new Date(),
        };
        writes.push(
          prisma.xeroInvoiceRef.upsert({
            where: { xeroNumber },
            update: data,
            create: { xeroNumber, ...data },
          })
        );
      }
      if (writes.length) {
        await prisma.$transaction(writes);
        invoices += writes.length;
      }

      page++;
      if (batch.length < 100) {
        exhausted = true;
        break;
      }
      await sleep(CALL_DELAY_MS);
    }
  } catch (e) {
    // Keep the cursor where it got to, so a rate-limit or a blip resumes rather
    // than restarting a few dozen calls from the top.
    await writeCursor(page);
    return {
      pagesFetched,
      invoices,
      nextPage: page,
      total: await prisma.xeroInvoiceRef.count(),
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (exhausted) {
    await prisma.setting.deleteMany({ where: { key: INDEX_CURSOR_KEY } });
    await prisma.setting.upsert({
      where: { key: INDEX_DONE_KEY },
      update: { value: new Date().toISOString() },
      create: { key: INDEX_DONE_KEY, value: new Date().toISOString() },
    });
  } else {
    await writeCursor(page);
  }

  revalidatePath("/settings");
  revalidatePath("/invoices/import");

  return {
    pagesFetched,
    invoices,
    nextPage: exhausted ? null : page,
    total: await prisma.xeroInvoiceRef.count(),
  };
}

async function writeCursor(page: number) {
  await prisma.setting.upsert({
    where: { key: INDEX_CURSOR_KEY },
    update: { value: String(page) },
    create: { key: INDEX_CURSOR_KEY, value: String(page) },
  });
}

export type IndexStatus = { total: number; nextPage: number | null; lastCompletedAt: Date | null };

export async function invoiceIndexStatus(): Promise<IndexStatus> {
  const [total, cursor, done] = await Promise.all([
    prisma.xeroInvoiceRef.count(),
    prisma.setting.findUnique({ where: { key: INDEX_CURSOR_KEY } }),
    prisma.setting.findUnique({ where: { key: INDEX_DONE_KEY } }),
  ]);
  const next = cursor ? parseInt(cursor.value, 10) : NaN;
  return {
    total,
    nextPage: Number.isFinite(next) ? next : null,
    lastCompletedAt: done ? new Date(done.value) : null,
  };
}

export type ImportResult = {
  summary: CombineSummary;
  created: number;
  updated: number;
  /** Lines whose invoice number wasn't in the index — imported unlinked. */
  unindexed: number;
  /** Lines whose contact isn't a client here. Imported; they just can't match. */
  unresolvedClient: number;
  /** Lines whose client came from the contact name because the index lacked it. */
  resolvedByName: number;
  distinctUnindexedInvoices: number;
};

/**
 * Import a set of Xero sales-invoice exports.
 *
 * Every line is keyed on (xeroInvoiceId, lineIndex), the same key the API sync
 * uses — so a CSV row for an invoice already pulled through the API updates
 * that row instead of duplicating it, and re-importing the same files changes
 * nothing. The update payload omits `recurringServiceId` and `reviewed` for the
 * same reason the API sync does: a human's linking decision outranks a refresh.
 */
export async function importInvoiceCsvs(texts: string[]): Promise<ImportResult> {
  await requireUser();

  const { lines, summary } = combineExports(texts);

  // Both lookups are small enough to hold in memory (4.4k invoices, 225
  // clients) and doing them per-row would be thousands of queries.
  const refs = new Map(
    (
      await prisma.xeroInvoiceRef.findMany({
        select: { xeroNumber: true, xeroInvoiceId: true, contactId: true },
      })
    ).map((r) => [r.xeroNumber, r])
  );
  const allClients = await prisma.client.findMany({
    select: { id: true, name: true, xeroContactId: true },
  });
  const clientByContact = new Map(
    allClients.filter((c) => c.xeroContactId).map((c) => [c.xeroContactId!, c.id])
  );

  /**
   * Fallback when the index hasn't run: match the contact by name.
   *
   * The index is the better answer — a ContactID is exact where a name is a
   * guess — but insisting on it would make the CSV import do nothing at all
   * until a few dozen API calls have been made, and the whole point of reading
   * a CSV is that it works without them. `nameKey` already strips company-form
   * words and punctuation, so "Ffynnon Wen Remedies" reaches
   * "Ffynnonwen Remedies Ltd".
   *
   * A name colliding across two clients is dropped rather than guessed at:
   * attaching invoices to the wrong client is worse than attaching none.
   */
  const byName = new Map<string, string | null>();
  for (const c of allClients) {
    const key = nameKey(c.name);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : c.id);
  }

  // Prisma's upsert doesn't report which branch it took, so the split between
  // new and refreshed rows comes from the row count either side of the run.
  const before = await prisma.xeroInvoiceLine.count();
  let unresolvedClient = 0;
  let resolvedByName = 0;
  const unindexedInvoices = new Set<string>();

  for (let i = 0; i < lines.length; i += WRITE_CHUNK) {
    const chunk = lines.slice(i, i + WRITE_CHUNK);

    // Chunked rather than one transaction: 5,000+ upserts in a single SQLite
    // transaction holds a write lock long enough to stall the rest of the app,
    // and a failure halfway would roll back work that is perfectly good. Each
    // chunk is independently idempotent, so a retry costs nothing.
    await prisma.$transaction(
      chunk.map((line) => {
        const ref = refs.get(line.xeroNumber);
        if (!ref) unindexedInvoices.add(line.xeroNumber);

        // Without a GUID the line still imports, under a key derived from its
        // number. It matches, it reports, it just can't deep-link — and the next
        // index sync adopts it (see adoptCsvLines).
        const xeroInvoiceId = ref?.xeroInvoiceId ?? `csv:${line.xeroNumber}`;
        const contactId = ref?.contactId ?? "";

        let clientId = contactId ? (clientByContact.get(contactId) ?? null) : null;
        if (!clientId) {
          const guess = byName.get(nameKey(line.contactName));
          if (guess) {
            clientId = guess;
            resolvedByName++;
          }
        }
        if (!clientId) unresolvedClient++;

        const data = {
          xeroNumber: line.xeroNumber,
          contactId,
          clientId,
          invoiceDate: line.invoiceDate,
          status: line.status,
          reference: line.reference,
          description: line.description,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          lineAmount: line.lineAmount,
          itemCode: line.itemCode,
          domains: line.domains.length ? JSON.stringify(line.domains) : null,
          syncedAt: new Date(),
        };

        return prisma.xeroInvoiceLine.upsert({
          where: { xeroInvoiceId_lineIndex: { xeroInvoiceId, lineIndex: line.lineIndex } },
          update: data,
          create: { xeroInvoiceId, lineIndex: line.lineIndex, ...data },
        });
      })
    );
  }

  const after = await prisma.xeroInvoiceLine.count();
  const created = after - before;
  const updated = lines.length - created;

  revalidatePath("/invoices/import");
  revalidatePath("/invoices/review");
  revalidatePath("/recurring/billed");

  return {
    summary,
    created,
    updated,
    unindexed: lines.filter((l) => !refs.has(l.xeroNumber)).length,
    unresolvedClient,
    resolvedByName,
    distinctUnindexedInvoices: unindexedInvoices.size,
  };
}

/**
 * Re-key lines imported before their invoice was indexed.
 *
 * Run after an index sync. Where a real GUID now exists for a `csv:` row, the
 * row moves onto it — unless an API-sourced row already holds that key, in
 * which case the CSV row is redundant and goes, since the API version carries
 * the same content plus a genuine contact.
 */
export async function adoptCsvLines(): Promise<{ adopted: number; discarded: number }> {
  await requireUser();

  const orphans = await prisma.xeroInvoiceLine.findMany({
    where: { xeroInvoiceId: { startsWith: "csv:" } },
    select: { id: true, xeroInvoiceId: true, lineIndex: true, xeroNumber: true, recurringServiceId: true, reviewed: true },
  });
  if (!orphans.length) return { adopted: 0, discarded: 0 };

  const refs = new Map(
    (
      await prisma.xeroInvoiceRef.findMany({
        where: { xeroNumber: { in: [...new Set(orphans.map((o) => o.xeroNumber ?? ""))] } },
        select: { xeroNumber: true, xeroInvoiceId: true, contactId: true },
      })
    ).map((r) => [r.xeroNumber, r])
  );

  const clientByContact = new Map(
    (
      await prisma.client.findMany({
        where: { xeroContactId: { not: null } },
        select: { id: true, xeroContactId: true },
      })
    ).map((c) => [c.xeroContactId!, c.id])
  );

  let adopted = 0;
  let discarded = 0;

  for (const orphan of orphans) {
    const ref = refs.get(orphan.xeroNumber ?? "");
    if (!ref) continue;

    const taken = await prisma.xeroInvoiceLine.findUnique({
      where: {
        xeroInvoiceId_lineIndex: { xeroInvoiceId: ref.xeroInvoiceId, lineIndex: orphan.lineIndex },
      },
      select: { id: true, recurringServiceId: true, reviewed: true },
    });

    if (taken) {
      // Carry across a decision the CSV row picked up that the API row lacks,
      // then drop the duplicate.
      if (orphan.recurringServiceId && !taken.recurringServiceId) {
        await prisma.xeroInvoiceLine.update({
          where: { id: taken.id },
          data: { recurringServiceId: orphan.recurringServiceId, reviewed: orphan.reviewed },
        });
      }
      await prisma.xeroInvoiceLine.delete({ where: { id: orphan.id } });
      discarded++;
      continue;
    }

    await prisma.xeroInvoiceLine.update({
      where: { id: orphan.id },
      data: {
        xeroInvoiceId: ref.xeroInvoiceId,
        contactId: ref.contactId,
        clientId: clientByContact.get(ref.contactId) ?? null,
      },
    });
    adopted++;
  }

  revalidatePath("/invoices/review");
  return { adopted, discarded };
}
