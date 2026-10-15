"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isServiceKind, isCostBasis } from "@/lib/recurring";
import { registrableDomain, extractDomains } from "@/lib/domains";
import { suggestMatch, isAutoAssignable } from "@/lib/matching";
import { buildMatchContext } from "@/lib/match-context";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

type ImportRow = {
  label: string;
  externalRef: string | null;
  renewalDate: string | null;
  costPrice: number | null;
  sellPrice: number | null;
  quantity: number | null;
  /** Who the licence is sold against, when the row names a buyer not a site. */
  customer: string | null;
  /** From a status column; null when the file has none. */
  active: boolean | null;
};

type ImportPayload = {
  kind: string;
  provider: string | null;
  termMonths: number;
  costBasis: string;
  rows: ImportRow[];
};

export type ImportSummary = {
  created: number;
  updated: number;
  matched: number;
  unassigned: number;
  websitesCreated: number;
};

/**
 * Import mapped CSV rows as recurring services.
 *
 * Dedupe: provider + externalRef when present, else kind + normalised label.
 * Existing rows are UPDATED (so next year's export refreshes renewal dates)
 * and never duplicated. Only high/medium-confidence client matches are applied
 * automatically — weaker guesses are left unassigned rather than risk invoicing
 * the wrong client.
 */
export async function importRecurringServices(formData: FormData): Promise<void> {
  await requireUser();

  let payload: ImportPayload;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    redirect("/recurring/import?importError=badpayload");
  }

  const kind = isServiceKind(payload.kind) ? payload.kind : "OTHER";
  const provider = payload.provider?.trim() || null;
  const termMonths = Math.round(payload.termMonths) || 12;
  const costBasis = isCostBasis(payload.costBasis ?? "") ? payload.costBasis : "ANNUAL";
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  const ctx = await buildMatchContext();
  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    matched: 0,
    unassigned: 0,
    websitesCreated: 0,
  };

  // Cache websites created during this run so rows sharing a domain group together.
  const websiteByDomainClient = new Map<string, string>();

  for (const raw of rows) {
    const rawLabel = String(raw.label ?? "").trim();
    const customer = raw.customer?.trim() || null;
    if (!rawLabel && !customer) continue;

    // A row that already names a domain identifies itself; the customer column
    // is then either redundant or actively misleading — a hosting sheet's
    // "client_name" is the reseller, so folding it in would rename every row
    // after ourselves and bury the domain the matching depends on.
    //
    // Only when there's no domain to go on does the customer become the
    // identity: an O365 export repeats the product in every row and names the
    // buyer only once, so "Aberdashery — Microsoft 365 Business Basic" is both
    // the readable label and the only thing distinguishing the rows.
    const selfIdentifying = !!(registrableDomain(rawLabel) || extractDomains(rawLabel)[0]);
    const label =
      selfIdentifying || !customer
        ? rawLabel
        : rawLabel
          ? `${customer} — ${rawLabel}`
          : customer;

    const existing = await findExisting(kind, label, provider, raw.externalRef);
    // Match on whatever actually identifies the buyer.
    const match = suggestMatch(selfIdentifying ? rawLabel : (customer ?? label), ctx);
    const autoAssign = isAutoAssignable(match.confidence) && match.clientId;

    const renewalDate = raw.renewalDate ? new Date(raw.renewalDate) : null;
    const fields = {
      kind,
      label,
      provider,
      externalRef: raw.externalRef ?? undefined,
      quantity: raw.quantity ?? undefined,
      costPrice: raw.costPrice ?? undefined,
      // Fall back to what we last charged for this domain in Xero.
      sellPrice: raw.sellPrice ?? match.suggestedSellPrice ?? undefined,
      renewalDate: renewalDate && !isNaN(renewalDate.getTime()) ? renewalDate : undefined,
      termMonths,
      costBasis,
      ...(raw.active === null || raw.active === undefined ? {} : { active: raw.active }),
    };

    if (existing) {
      // Never clear an existing client assignment on re-import.
      await prisma.recurringService.update({
        where: { id: existing.id },
        data: {
          ...fields,
          ...(existing.clientId ? {} : autoAssign ? { clientId: match.clientId } : {}),
        },
      });
      summary.updated++;
      if (existing.clientId || autoAssign) summary.matched++;
      else summary.unassigned++;
      continue;
    }

    let websiteId: string | null = match.websiteId;
    if (!websiteId && autoAssign) {
      websiteId = await ensureWebsite(label, match.clientId!, websiteByDomainClient, summary);
    }

    await prisma.recurringService.create({
      data: {
        ...fields,
        clientId: autoAssign ? match.clientId : null,
        websiteId,
      },
    });
    summary.created++;
    if (autoAssign) summary.matched++;
    else summary.unassigned++;
  }

  revalidatePath("/recurring");
  revalidatePath("/clients");

  const params = new URLSearchParams({
    imported: "1",
    created: String(summary.created),
    updated: String(summary.updated),
    matched: String(summary.matched),
    unassigned: String(summary.unassigned),
    websites: String(summary.websitesCreated),
  });
  redirect(`/recurring?${params.toString()}`);
}

/** Existing service to update: provider ref first, then normalised label. */
async function findExisting(
  kind: string,
  label: string,
  provider: string | null,
  externalRef: string | null | undefined
) {
  if (externalRef && provider) {
    const byRef = await prisma.recurringService.findFirst({ where: { provider, externalRef } });
    if (byRef) return byRef;
  }
  const domain = registrableDomain(label) || extractDomains(label)[0] || "";
  const candidates = await prisma.recurringService.findMany({ where: { kind } });
  return (
    candidates.find((c) => c.label.toLowerCase() === label.toLowerCase()) ??
    (domain
      ? candidates.find(
          (c) => (registrableDomain(c.label) || extractDomains(c.label)[0] || "") === domain
        )
      : undefined) ??
    null
  );
}

/** Group services under one Website per registrable domain per client. */
async function ensureWebsite(
  label: string,
  clientId: string,
  cache: Map<string, string>,
  summary: ImportSummary
): Promise<string | null> {
  const domain = registrableDomain(label) || extractDomains(label)[0] || "";
  if (!domain) return null;

  const key = `${clientId}:${domain}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = await prisma.website.findFirst({ where: { clientId, name: domain } });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const created = await prisma.website.create({ data: { clientId, name: domain } });
  cache.set(key, created.id);
  summary.websitesCreated++;
  return created.id;
}
