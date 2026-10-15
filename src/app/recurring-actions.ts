"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resnapServiceBillings } from "@/lib/billing-apply";
import { auth } from "@/auth";
import { isManagedBy, isServiceKind, isCostBasis } from "@/lib/recurring";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const opt = (fd: FormData, key: string) => str(fd, key) || null;
const num = (fd: FormData, key: string) => {
  const n = parseFloat(str(fd, key));
  return Number.isFinite(n) ? n : 0;
};
const optDate = (fd: FormData, key: string) => {
  const s = str(fd, key);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
  return isNaN(d.getTime()) ? null : d;
};

/** Revalidate everywhere a service or website can show up. */
function revalidateAll(clientId?: string | null, websiteId?: string | null) {
  revalidatePath("/recurring");
  revalidatePath("/websites");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  if (websiteId) revalidatePath(`/websites/${websiteId}`);
}

/* ---------- Websites ---------- */

export async function createWebsite(formData: FormData) {
  await requireUser();
  const name = str(formData, "name");
  if (!name) return;
  const clientId = opt(formData, "clientId");
  const site = await prisma.website.create({
    data: { name, clientId, url: opt(formData, "url"), notes: opt(formData, "notes") },
  });
  revalidateAll(clientId, site.id);
}

export async function updateWebsite(id: string, formData: FormData) {
  await requireUser();
  const name = str(formData, "name");
  if (!name) return;
  const site = await prisma.website.update({
    where: { id },
    data: { name, url: opt(formData, "url"), notes: opt(formData, "notes") },
  });
  revalidateAll(site.clientId, site.id);
}

export async function deleteWebsite(id: string) {
  await requireUser();
  const site = await prisma.website.findUnique({ where: { id } });
  if (!site) return;
  // Detach services rather than cascading — the services are the billable
  // things and must survive losing their grouping.
  await prisma.recurringService.updateMany({ where: { websiteId: id }, data: { websiteId: null } });
  await prisma.website.delete({ where: { id } });
  revalidateAll(site.clientId);
}

/* ---------- Recurring services ---------- */

function catalogueKind(category: string): string | null {
  if (/hosting/i.test(category)) return "HOSTING";
  if (/office\s*365/i.test(category)) return "O365";
  if (/care\s*plan/i.test(category)) return "CAREPLAN";
  return null;
}

async function serviceFields(formData: FormData) {
  const catalogueServiceId = opt(formData, "catalogueServiceId");
  const catalogue = catalogueServiceId
    ? await prisma.service.findUnique({ where: { id: catalogueServiceId } })
    : null;
  const kind = str(formData, "kind");
  const requestedTerm = Math.round(num(formData, "termMonths"));
  const termMonths = requestedTerm > 0 ? requestedTerm : 12;
  const enteredSell = str(formData, "sellPrice");
  const cataloguePeriodPrice = catalogue
    ? catalogue.unit === "month"
      ? catalogue.price * termMonths
      : catalogue.unit === "year"
        ? catalogue.price * (termMonths / 12)
        : catalogue.price
    : 0;
  return {
    kind: catalogueKind(catalogue?.category ?? "") ?? (isServiceKind(kind) ? kind : "OTHER"),
    label: str(formData, "label") || catalogue?.name || "",
    catalogueServiceId: catalogue?.id ?? null,
    provider: opt(formData, "provider"),
    managedBy: isManagedBy(str(formData, "managedBy")) ? str(formData, "managedBy") : "GCW",
    externalRef: opt(formData, "externalRef"),
    quantity: num(formData, "quantity") || 1,
    costPrice: num(formData, "costPrice"),
    costBasis: isCostBasis(str(formData, "costBasis")) ? str(formData, "costBasis") : "ANNUAL",
    sellPrice: enteredSell ? num(formData, "sellPrice") : cataloguePeriodPrice,
    renewalDate: optDate(formData, "renewalDate"),
    termMonths,
    // A linked catalogue product owns the default Xero mapping. Unlinking it
    // must not erase a custom mapping already held by an imported service.
    xeroItemCode: catalogue ? catalogue.xeroItemCode : undefined,
    notes: opt(formData, "notes"),
  };
}

export async function createRecurringService(formData: FormData) {
  await requireUser();
  const fields = await serviceFields(formData);
  if (!fields.label) return;
  const clientId = opt(formData, "clientId");
  const websiteId = opt(formData, "websiteId");
  await prisma.recurringService.create({ data: { ...fields, clientId, websiteId } });
  revalidateAll(clientId, websiteId);
}

export async function updateRecurringService(id: string, formData: FormData) {
  await requireUser();
  const fields = await serviceFields(formData);
  if (!fields.label) return;

  const before = await prisma.recurringService.findUnique({
    where: { id },
    select: { renewalDate: true, termMonths: true },
  });

  const service = await prisma.recurringService.update({
    where: { id },
    data: {
      ...fields,
      active: formData.get("active") === "on",
      websiteId: opt(formData, "websiteId"),
    },
  });

  // Billing periods are derived from the renewal date, so changing it leaves
  // the existing history snapped to the old one — periods a month or more out,
  // which can overlap and hide a genuinely unbilled year. Re-derive them.
  const dateChanged = before?.renewalDate?.getTime() !== service.renewalDate?.getTime();
  const termChanged = before?.termMonths !== service.termMonths;
  if (dateChanged || termChanged) await resnapServiceBillings(id);
  revalidateAll(service.clientId, service.websiteId);
}

export async function deleteRecurringService(id: string) {
  await requireUser();
  const service = await prisma.recurringService.findUnique({ where: { id } });
  if (!service) return;
  await prisma.recurringService.delete({ where: { id } });
  revalidateAll(service.clientId, service.websiteId);
}

/** Assign an unmatched service to a client — the Unassigned-queue action. */
export async function assignServiceToClient(id: string, formData: FormData) {
  await requireUser();
  const clientId = opt(formData, "clientId");
  if (!clientId) return;
  const before = await prisma.recurringService.findUnique({ where: { id } });
  const after = await prisma.recurringService.update({ where: { id }, data: { clientId } });
  revalidateAll(clientId, after.websiteId);
  if (before?.clientId && before.clientId !== clientId) revalidatePath(`/clients/${before.clientId}`);
}

/** Attach one loose recurring service to a website from a specialist service view. */
export async function assignServiceToWebsite(id: string, formData: FormData) {
  await requireUser();
  const websiteId = opt(formData, "websiteId");
  if (!websiteId) return;

  const [before, website] = await Promise.all([
    prisma.recurringService.findUnique({ where: { id } }),
    prisma.website.findUnique({ where: { id: websiteId } }),
  ]);
  if (!before || !website) return;

  const after = await prisma.recurringService.update({
    where: { id },
    data: {
      websiteId,
      // A website with a client is authoritative. This prevents a service
      // appearing under one client's website while billing another client.
      ...(website.clientId ? { clientId: website.clientId } : {}),
    },
  });
  revalidateAll(after.clientId, websiteId);
  revalidatePath("/recurring/microsoft-365");
  if (before.websiteId && before.websiteId !== websiteId) revalidatePath(`/websites/${before.websiteId}`);
  if (before.clientId && before.clientId !== after.clientId) revalidatePath(`/clients/${before.clientId}`);
}

export async function setServiceActive(id: string, active: boolean) {
  await requireUser();
  const service = await prisma.recurringService.update({ where: { id }, data: { active } });
  revalidateAll(service.clientId, service.websiteId);
}

/**
 * Mark a service as not renewing, or put it back.
 *
 * Cancelling leaves everything about the current term alone — it still runs, and
 * still needs invoicing if it never was. Only the next renewal stops: no advance
 * billing, and nothing in the forward calendar.
 *
 * Deliberately separate from `setServiceActive`. Deactivating hides a row from
 * every view, which would take an unbilled year out of sight along with it —
 * exactly the money this system exists to catch.
 */
export async function setServiceCancelled(id: string, cancelled: boolean) {
  await requireUser();
  const service = await prisma.recurringService.update({
    where: { id },
    data: { cancelledAt: cancelled ? new Date() : null },
  });
  revalidateAll(service.clientId, service.websiteId);
  revalidatePath("/recurring/dashboard");
  revalidatePath("/invoices/run");
}

/** Mark an internally owned domain as tracked but never customer-billable. */
export async function setServiceInternal(id: string, internal: boolean) {
  await requireUser();
  const service = await prisma.recurringService.update({
    where: { id },
    data: { managedBy: internal ? "INTERNAL" : "GCW" },
  });
  revalidateAll(service.clientId, service.websiteId);
  revalidatePath("/recurring/dashboard");
  revalidatePath("/invoices/run");
}
