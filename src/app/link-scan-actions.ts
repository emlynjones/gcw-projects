"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { applyLinks } from "@/lib/billing-apply";
import { aiComplete } from "@/lib/ai";
import { getAiStatus } from "@/lib/settings";
import { scanForLinks, type LinkProposal, type ScanConfidence } from "@/lib/link-scan";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

export type ScanRow = {
  lineId: string;
  description: string;
  clientId: string;
  clientName: string;
  amount: number;
  invoiceDate: Date;
  xeroNumber: string | null;
  xeroInvoiceId: string | null;
  serviceId: string;
  serviceLabel: string;
  serviceKind: string;
  confidence: ScanConfidence;
  reason: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  alternatives: { id: string; label: string; kind: string }[];
  /** Set when the choice came from the model rather than the rules. */
  fromAi?: boolean;
};

export type ScanSummary = {
  rows: ScanRow[];
  scanned: number;
  notRecurring: number;
  missingByKind: Record<string, number>;
  missingTotal: number;
  aiConfigured: boolean;
};

/**
 * Propose links for every invoice line the strict matcher left unplaced.
 *
 * Read-only and free — no API calls, no writes. The AI pass is a separate,
 * explicit step over the residue this can't decide.
 */
export async function runLinkScan(): Promise<ScanSummary> {
  await requireUser();

  const [lines, services, ai] = await Promise.all([
    prisma.xeroInvoiceLine.findMany({
      where: { recurringServiceId: null, clientId: { not: null }, reviewed: false },
      select: {
        id: true,
        description: true,
        clientId: true,
        lineAmount: true,
        invoiceDate: true,
        xeroNumber: true,
        xeroInvoiceId: true,
        client: { select: { name: true } },
      },
    }),
    prisma.recurringService.findMany({
      where: { active: true, clientId: { not: null } },
      select: {
        id: true,
        clientId: true,
        kind: true,
        label: true,
        sellPrice: true,
        quantity: true,
        renewalDate: true,
        termMonths: true,
      },
    }),
    getAiStatus(),
  ]);

  const scanLines = lines.map((l) => ({
    id: l.id,
    description: l.description,
    clientId: l.clientId!,
    clientName: l.client?.name ?? "",
    lineAmount: l.lineAmount,
    invoiceDate: l.invoiceDate,
    xeroNumber: l.xeroNumber,
    xeroInvoiceId: l.xeroInvoiceId,
  }));

  const result = scanForLinks(
    scanLines,
    services.map((s) => ({ ...s, clientId: s.clientId! }))
  );

  const lineById = new Map(scanLines.map((l) => [l.id, l]));
  const svcById = new Map(services.map((s) => [s.id, s]));

  const missingByKind: Record<string, number> = {};
  for (const m of result.missingService) {
    missingByKind[m.kind] = (missingByKind[m.kind] ?? 0) + 1;
  }

  return {
    rows: toRows(result.proposals, lineById, svcById),
    scanned: lines.length,
    notRecurring: result.notRecurring,
    missingByKind,
    missingTotal: result.missingService.length,
    aiConfigured: ai.configured,
  };
}

function toRows(
  proposals: LinkProposal[],
  lineById: Map<string, { description: string; clientId: string; clientName: string; lineAmount: number; invoiceDate: Date; xeroNumber: string | null; xeroInvoiceId: string | null }>,
  svcById: Map<string, { label: string; kind: string }>
): ScanRow[] {
  const rows: ScanRow[] = [];
  for (const p of proposals) {
    const l = lineById.get(p.lineId);
    const s = svcById.get(p.serviceId);
    if (!l || !s) continue;
    rows.push({
      lineId: p.lineId,
      description: l.description,
      clientId: l.clientId,
      clientName: l.clientName,
      amount: l.lineAmount,
      invoiceDate: l.invoiceDate,
      xeroNumber: l.xeroNumber,
      xeroInvoiceId: l.xeroInvoiceId,
      serviceId: p.serviceId,
      serviceLabel: s.label,
      serviceKind: s.kind,
      confidence: p.confidence,
      reason: p.reason,
      periodStart: p.period?.start ?? null,
      periodEnd: p.period?.end ?? null,
      alternatives: p.alternatives,
    });
  }
  const order: Record<ScanConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return rows.sort(
    (a, b) => order[a.confidence] - order[b.confidence] || b.amount - a.amount
  );
}

/** How many ambiguous lines go in one prompt. Small enough to stay reliable. */
const AI_BATCH = 20;

/**
 * Ask the model to choose between candidates on the lines the rules can't split.
 *
 * Deliberately narrow. The model never sees a line it could invent an answer
 * for: it is handed a description and two to six real services belonging to that
 * client, and must pick one of their ids or say none. It cannot create a
 * service, reach another client's data, or change what a link means. Anything it
 * returns still arrives as an unticked proposal for a person to confirm.
 *
 * Only the ~100 genuinely ambiguous lines are sent — the 400-odd the rules
 * settle are never put to a model, because paying for a guess at something
 * already known is waste.
 */
export async function aiDisambiguate(): Promise<void> {
  await requireUser();
  const back = "/invoices/link-scan";

  const ai = await getAiStatus();
  if (!ai.configured) {
    redirect(`${back}?scanError=${encodeURIComponent("AI isn't configured — add a key in Settings.")}`);
  }

  const summary = await runLinkScan();
  const ambiguous = summary.rows.filter((r) => r.confidence === "LOW");
  if (!ambiguous.length) redirect(`${back}?aiDone=0`);

  const decisions = new Map<string, { serviceId: string; reason: string }>();

  for (let i = 0; i < ambiguous.length; i += AI_BATCH) {
    const batch = ambiguous.slice(i, i + AI_BATCH);
    const payload = batch.map((r) => ({
      lineId: r.lineId,
      invoice: r.xeroNumber,
      date: r.invoiceDate.toISOString().slice(0, 10),
      amount: r.amount,
      description: r.description,
      candidates: [
        { id: r.serviceId, label: r.serviceLabel, kind: r.serviceKind },
        ...r.alternatives,
      ],
    }));

    let raw: string;
    try {
      raw = await aiComplete(
        [
          "You match accounting invoice lines to recurring services (domains, hosting, Office 365 licences, website care plans).",
          "For each line you are given the exact candidate services belonging to that client.",
          "Choose the candidate the line is most likely paying for, using the wording, the amount and the date.",
          "If nothing in the line distinguishes the candidates, return null — a wrong link is worse than no link.",
          'Reply with JSON only: [{"lineId":"...","serviceId":"..." or null,"reason":"under 12 words"}]',
        ].join(" "),
        JSON.stringify(payload),
        2000
      );
    } catch (e) {
      redirect(
        `${back}?scanError=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`
      );
    }

    // Models like to wrap JSON in prose or a fence; take the array.
    const match = /\[[\s\S]*\]/.exec(raw);
    if (!match) continue;
    let parsed: { lineId?: string; serviceId?: string | null; reason?: string }[];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      continue;
    }

    for (const d of parsed) {
      if (!d?.lineId || !d.serviceId) continue;
      const row = batch.find((r) => r.lineId === d.lineId);
      if (!row) continue;
      // Only ever one of the candidates we offered. A hallucinated id, or one
      // belonging to another client, is dropped rather than trusted.
      const allowed = [row.serviceId, ...row.alternatives.map((a) => a.id)];
      if (!allowed.includes(d.serviceId)) continue;
      decisions.set(d.lineId, {
        serviceId: d.serviceId,
        reason: (d.reason ?? "").slice(0, 120),
      });
    }
  }

  await prisma.setting.upsert({
    where: { key: "linkScanAi" },
    update: { value: JSON.stringify([...decisions]) },
    create: { key: "linkScanAi", value: JSON.stringify([...decisions]) },
  });

  revalidatePath(back);
  redirect(`${back}?aiDone=${decisions.size}&aiOf=${ambiguous.length}`);
}

/** The model's stored picks, folded into a scan. */
export async function applyAiDecisions(summary: ScanSummary): Promise<ScanSummary> {
  const stored = await prisma.setting.findUnique({ where: { key: "linkScanAi" } });
  if (!stored?.value) return summary;

  let decisions: [string, { serviceId: string; reason: string }][];
  try {
    decisions = JSON.parse(stored.value);
  } catch {
    return summary;
  }
  const byLine = new Map(decisions);
  if (!byLine.size) return summary;

  const services = await prisma.recurringService.findMany({
    where: { id: { in: [...byLine.values()].map((d) => d.serviceId) } },
    select: { id: true, label: true, kind: true },
  });
  const svcById = new Map(services.map((s) => [s.id, s]));

  return {
    ...summary,
    rows: summary.rows.map((r) => {
      const d = byLine.get(r.lineId);
      const s = d ? svcById.get(d.serviceId) : null;
      if (!d || !s) return r;
      return {
        ...r,
        serviceId: d.serviceId,
        serviceLabel: s.label,
        serviceKind: s.kind,
        confidence: "MEDIUM" as ScanConfidence,
        reason: d.reason || "Chosen by AI from the candidates",
        fromAi: true,
      };
    }),
  };
}

/**
 * Link the ticked lines to their proposed services.
 *
 * Every pair is re-checked against the current scan rather than trusted from
 * the form: the browser sends which line goes to which service, and both must
 * still be a proposal this scan would make.
 */
export async function applyScanSelections(formData: FormData): Promise<void> {
  await requireUser();
  const back = "/invoices/link-scan";

  const picked = formData
    .getAll("pair")
    .map(String)
    .map((v) => {
      const [lineId, serviceId] = v.split("|");
      return { lineId, serviceId };
    })
    .filter((p) => p.lineId && p.serviceId);

  if (!picked.length) redirect(`${back}?scanError=${encodeURIComponent("Nothing selected.")}`);

  const summary = await applyAiDecisions(await runLinkScan());
  const valid = picked.filter((p) =>
    summary.rows.some(
      (r) =>
        r.lineId === p.lineId &&
        (r.serviceId === p.serviceId || r.alternatives.some((a) => a.id === p.serviceId))
    )
  );
  if (!valid.length) {
    redirect(`${back}?scanError=${encodeURIComponent("Those proposals are out of date — rescan.")}`);
  }

  const { linked, pricesSet } = await applyLinks(valid, "MANUAL");

  revalidatePath(back);
  revalidatePath("/recurring/dashboard");
  revalidatePath("/reports/recurring");
  revalidatePath("/invoices/run");
  redirect(`${back}?linked=${linked}&priced=${pricesSet}`);
}
