"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { matchInvoiceLines, toMatchableLine, type MatchableService } from "@/lib/billing-match";
import { applyLinks, applyIgnores } from "@/lib/billing-apply";
import { serviceKindLabel } from "@/lib/recurring";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

export type QueueRow = {
  lineId: string;
  serviceId: string;
  serviceLabel: string;
  serviceKind: string;
  clientId: string;
  clientName: string;
  confidence: string;
  reason: string;
  periodLabel: string;
  gapDays: number;
  amount: number;
  suggestedSellPrice: number | null;
  auto: boolean;
  description: string;
  xeroNumber: string | null;
  xeroInvoiceId: string;
  invoiceDate: Date;
};

/**
 * Match every unreviewed invoice line against the services of its own client.
 *
 * Scoped per client, never globally. The matcher's strength rests on tests like
 * "exactly one service holds this domain", which are meaningful across one
 * client's dozen services and meaningless across 440 — and comparing 5,400
 * lines to every service would be both wrong and slow.
 *
 * Read-only: nothing is written until a row is confirmed. That's the point of
 * the queue, and it's why this can be re-run freely.
 */
export async function buildReviewQueue(): Promise<QueueRow[]> {
  await requireUser();

  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      recurringServices: {
        select: {
          id: true,
          kind: true,
          label: true,
          quantity: true,
          costPrice: true,
          sellPrice: true,
          renewalDate: true,
          termMonths: true,
        },
      },
      xeroInvoiceLines: {
        where: { reviewed: false },
        select: {
          id: true,
          xeroInvoiceId: true,
          lineIndex: true,
          xeroNumber: true,
          invoiceDate: true,
          status: true,
          description: true,
          reference: true,
          quantity: true,
          lineAmount: true,
          domains: true,
        },
      },
    },
  });

  // Periods that already have a billing, and which line put it there.
  //
  // resolveContention settles a contested period only within a single pass. The
  // moment the winner is applied it leaves the queue, and the loser — a £20
  // domain line that also names the site, say — is re-judged on its own and
  // looks unambiguous again. Applying it would upsert onto the same
  // (service, period) key and quietly replace a £95 hosting billing with £20.
  // Verified against the real ledger: 23 proposals would have done exactly that.
  //
  // A second line for a period someone has already accounted for is still worth
  // seeing — it can be a correction, or a genuine double-charge — so it stays in
  // the queue. It just never applies itself.
  const claimed = new Map<string, string>();
  for (const b of await prisma.serviceBilling.findMany({
    select: { recurringServiceId: true, periodStart: true, xeroInvoiceId: true, xeroLineIndex: true },
  })) {
    claimed.set(
      `${b.recurringServiceId}@${b.periodStart.getTime()}`,
      `${b.xeroInvoiceId ?? ""}#${b.xeroLineIndex ?? ""}`
    );
  }

  const rows: QueueRow[] = [];

  for (const client of clients) {
    if (!client.recurringServices.length || !client.xeroInvoiceLines.length) continue;

    const services: MatchableService[] = client.recurringServices;
    const lines = client.xeroInvoiceLines.map(toMatchableLine);
    const { proposals } = matchInvoiceLines(lines, services);
    const byId = new Map(client.xeroInvoiceLines.map((l) => [l.id, l]));
    const kindById = new Map(client.recurringServices.map((s) => [s.id, s.kind]));

    for (const p of proposals) {
      const line = byId.get(p.lineId);
      if (!line) continue;

      const holder = claimed.get(`${p.serviceId}@${p.period.start.getTime()}`);
      const takenByAnother = holder !== undefined && holder !== `${line.xeroInvoiceId}#${line.lineIndex}`;

      rows.push({
        lineId: p.lineId,
        serviceId: p.serviceId,
        serviceLabel: p.serviceLabel,
        serviceKind: serviceKindLabel(kindById.get(p.serviceId) ?? "OTHER"),
        clientId: client.id,
        clientName: client.name,
        confidence: p.confidence,
        reason: takenByAnother
          ? `${p.reason} — but another invoice line already covers that period`
          : p.reason,
        periodLabel: `${fmtDate(p.period.start)} – ${fmtDate(p.period.end)}`,
        gapDays: p.gapDays,
        amount: p.amount,
        suggestedSellPrice: p.suggestedSellPrice,
        auto: p.auto && !takenByAnother,
        description: line.description,
        xeroNumber: line.xeroNumber,
        xeroInvoiceId: line.xeroInvoiceId,
        invoiceDate: line.invoiceDate,
      });
    }
  }

  // Strongest first, then biggest money — the rows worth a human's time.
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  rows.sort(
    (a, b) =>
      Number(b.auto) - Number(a.auto) ||
      (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3) ||
      b.amount - a.amount
  );
  return rows;
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);

export type ApplyResult = { linked: number; ignored: number; pricesSet: number };

/**
 * Apply the rows ticked in the queue.
 *
 * Each pair is `lineId:serviceId`, so a decision can't be reassigned to a
 * different service by editing a single field.
 */
export async function applyReviewSelections(formData: FormData): Promise<void> {
  await requireUser();

  const pairs = formData
    .getAll("confirm")
    .map(String)
    .map((pair) => pair.split(":"))
    .filter(([lineId, serviceId]) => lineId && serviceId)
    .map(([lineId, serviceId]) => ({ lineId, serviceId }));

  const { linked, pricesSet } = await applyLinks(pairs, "MANUAL");
  const ignored = await applyIgnores(formData.getAll("ignore").map(String).filter(Boolean));

  revalidatePath("/invoices/review");
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");

  const params = new URLSearchParams({
    applied: "1",
    linked: String(linked),
    ignored: String(ignored),
    prices: String(pricesSet),
  });
  redirect(`/invoices/review?${params.toString()}`);
}

/**
 * Link every proposal the matcher considers safe, in one pass.
 *
 * "Safe" is the matcher's own `auto` flag: an unambiguous identification, near
 * the renewal it's been snapped to, at a price that looks like the thing it
 * claims to pay for. Anything short of all three stays in the queue.
 */
export async function confirmAllAuto(): Promise<void> {
  await requireUser();

  const rows = await buildReviewQueue();
  const auto = rows.filter((r) => r.auto);

  const { linked, pricesSet } = await applyLinks(
    auto.map((r) => ({ lineId: r.lineId, serviceId: r.serviceId })),
    "AUTO"
  );

  revalidatePath("/invoices/review");
  revalidatePath("/recurring");
  revalidatePath("/reports/recurring");

  const params = new URLSearchParams({
    applied: "1",
    linked: String(linked),
    ignored: "0",
    prices: String(pricesSet),
  });
  redirect(`/invoices/review?${params.toString()}`);
}

/** Undo a link — puts the line back in the queue and drops its billing record. */
export async function unlinkInvoiceLineGlobal(formData: FormData): Promise<void> {
  await requireUser();
  const lineId = String(formData.get("lineId") ?? "");
  if (!lineId) return;

  const line = await prisma.xeroInvoiceLine.findUnique({ where: { id: lineId } });
  if (!line) return;

  if (line.recurringServiceId) {
    await prisma.serviceBilling.deleteMany({
      where: {
        recurringServiceId: line.recurringServiceId,
        xeroInvoiceId: line.xeroInvoiceId,
        xeroLineIndex: line.lineIndex,
      },
    });
  }
  await prisma.xeroInvoiceLine.update({
    where: { id: lineId },
    data: { recurringServiceId: null, reviewed: false },
  });

  revalidatePath("/invoices/review");
  revalidatePath("/reports/recurring");
}
