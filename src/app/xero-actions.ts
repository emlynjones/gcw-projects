"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isInvoiceKind } from "@/lib/status";
import {
  disconnect,
  getCustomers,
  getInvoicesByIds,
  createContact,
  createDraftInvoice,
  parseXeroDate,
  contactPhone,
  type InvoiceLine,
  type XeroContact,
} from "@/lib/xero";

type ProjectWithClient = {
  id: string;
  title: string;
  clientId: string;
  client: { name: string; email: string | null; contactName: string | null; phone: string | null; xeroContactId: string | null };
};

/** Ensure the project's client exists in Xero, returning the contact id (creates + persists if needed). */
async function ensureXeroContactId(project: ProjectWithClient): Promise<string> {
  if (project.client.xeroContactId) return project.client.xeroContactId;
  const contact = await createContact({
    name: project.client.name,
    email: project.client.email,
    contactName: project.client.contactName,
    phone: project.client.phone,
  });
  await prisma.client.update({ where: { id: project.clientId }, data: { xeroContactId: contact.ContactID } });
  return contact.ContactID;
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

export async function disconnectXero() {
  await requireUser();
  await disconnect();
  revalidatePath("/settings");
}

/** Create or link the local client for a Xero contact (matched by xeroContactId, email, or name). */
async function upsertClientFromXeroContact(c: XeroContact) {
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { xeroContactId: c.ContactID },
        ...(c.EmailAddress ? [{ email: c.EmailAddress }] : []),
        { name: c.Name },
      ],
    },
  });
  const data = {
    name: c.Name,
    contactName: [c.FirstName, c.LastName].filter(Boolean).join(" ") || null,
    email: c.EmailAddress || null,
    phone: contactPhone(c),
    xeroContactId: c.ContactID,
  };
  return existing
    ? prisma.client.update({ where: { id: existing.id }, data: { xeroContactId: c.ContactID } })
    : prisma.client.create({ data });
}

/** Import selected Xero contacts as local clients (or link if IDs already match). */
export async function importXeroContacts(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("contactId").map(String);
  if (!ids.length) redirect("/clients/xero-import");

  const customers = await getCustomers();
  const byId = new Map(customers.map((c) => [c.ContactID, c]));

  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    await upsertClientFromXeroContact(c);
  }
  revalidatePath("/clients");
  redirect("/clients");
}

/** Import (or link) a single Xero contact as a local client — used by the inline search picker. */
export async function importOneXeroContact(contactId: string): Promise<{ id: string; name: string }> {
  await requireUser();
  const customers = await getCustomers();
  const c = customers.find((x) => x.ContactID === contactId);
  if (!c) throw new Error("Xero contact not found");
  const client = await upsertClientFromXeroContact(c);
  revalidatePath("/clients");
  return { id: client.id, name: client.name };
}

/** Link an existing local client to a Xero contact. */
export async function linkClientToXero(clientId: string, formData: FormData) {
  await requireUser();
  const xeroContactId = String(formData.get("xeroContactId") ?? "");
  if (!xeroContactId) return;
  await prisma.client.update({ where: { id: clientId }, data: { xeroContactId } });
  revalidatePath(`/clients/${clientId}`);
}

/** Create a NEW local invoice row from an existing Xero invoice (the "Link invoice" modal). */
export async function linkNewInvoiceFromXero(projectId: string, formData: FormData) {
  await requireUser();
  const xeroInvoiceId = String(formData.get("xeroInvoiceId") ?? "");
  if (!xeroInvoiceId) return;
  const kind = String(formData.get("kind") ?? "");
  const [xi] = await getInvoicesByIds([xeroInvoiceId]);
  if (!xi) throw new Error("Xero invoice not found");
  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber ?? xi.Reference ?? xeroInvoiceId.slice(0, 8),
      kind: isInvoiceKind(kind) ? kind : null,
      date: parseXeroDate(xi.Date) ?? new Date(),
      paid: xi.Status === "PAID",
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

/** Raise a DRAFT ad-hoc invoice in Xero, prefilled from the project (title, hours, amount). */
export async function raiseAdhocInvoice(projectId: string) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true },
  });
  if (project.totalValue <= 0) throw new Error("Set the project amount before invoicing.");

  const hours = project.hoursDone ?? project.hoursQuoted;
  const description = `${project.title}${hours ? ` (${hours} hrs)` : ""}`;
  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({
    contactId,
    reference: project.title,
    lines: [{ description, quantity: 1, unitAmount: project.totalValue }],
  });

  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber || project.title,
      kind: "ADHOC",
      date: new Date(),
      paid: false,
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
    },
  });
  // Invoicing an ad-hoc job at DONE is the last step — move it along automatically.
  if (project.type === "ADHOC" && project.stage === "DONE") {
    await prisma.project.update({ where: { id: projectId }, data: { stage: "INVOICED" } });
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/** Link a local invoice row to an existing Xero invoice and pull its state. */
export async function linkInvoiceToXero(invoiceId: string, projectId: string, formData: FormData) {
  await requireUser();
  const xeroInvoiceId = String(formData.get("xeroInvoiceId") ?? "");
  if (!xeroInvoiceId) return;
  const kind = String(formData.get("kind") ?? "");
  const [xi] = await getInvoicesByIds([xeroInvoiceId]);
  if (!xi) throw new Error("Xero invoice not found");
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
      kind: isInvoiceKind(kind) ? kind : undefined,
      amount: xi.SubTotal, // ex-VAT — matches app convention
      paid: xi.Status === "PAID",
      date: parseXeroDate(xi.Date) ?? undefined,
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function unlinkInvoiceFromXero(invoiceId: string, projectId: string) {
  await requireUser();
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { xeroInvoiceId: null, xeroNumber: null, xeroStatus: null, xeroSynced: false },
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Refresh all Xero-linked invoices on a project (status, amount, paid). */
export async function syncProjectInvoices(projectId: string) {
  await requireUser();
  const linked = await prisma.invoice.findMany({
    where: { projectId, xeroInvoiceId: { not: null } },
  });
  if (!linked.length) return;
  const xeroInvoices = await getInvoicesByIds(linked.map((i) => i.xeroInvoiceId as string));
  const byId = new Map(xeroInvoices.map((i) => [i.InvoiceID, i]));
  for (const inv of linked) {
    const xi = byId.get(inv.xeroInvoiceId as string);
    if (!xi) continue;
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        amount: xi.SubTotal,
        xeroNumber: xi.InvoiceNumber ?? null,
        xeroStatus: xi.Status,
        xeroSynced: true,
        paid: xi.Status === "PAID",
      },
    });
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

/** Create a DRAFT invoice in Xero from service line items; store the local row. */
export async function createXeroInvoice(projectId: string, formData: FormData) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true },
  });

  const lines: InvoiceLine[] = JSON.parse(String(formData.get("lines") ?? "[]"));
  const valid = lines.filter((l) => l.description && l.quantity > 0);
  if (!valid.length) throw new Error("No line items");
  const reference = String(formData.get("reference") ?? "").trim() || project.title;
  const kind = String(formData.get("kind") ?? "");

  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({ contactId, reference, lines: valid });

  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber || reference,
      kind: isInvoiceKind(kind) ? kind : null,
      date: new Date(),
      paid: false,
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/** Raise a DRAFT invoice in Xero from the project's linked services (the "invoice at the end" flow). */
export async function raiseInvoiceFromServices(projectId: string) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true, services: { orderBy: { sortOrder: "asc" } } },
  });
  const lines: InvoiceLine[] = project.services
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      description: s.unit && s.unit !== "one-off" ? `${s.name} (per ${s.unit})` : s.name,
      quantity: s.quantity,
      unitAmount: s.price,
    }));
  if (!lines.length) throw new Error("No services on this project to invoice.");

  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({ contactId, reference: project.title, lines });

  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber || project.title,
      kind: "FINAL",
      date: new Date(),
      paid: false,
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/** Raise a DRAFT deposit invoice in Xero: depositPct% of the project total, one line, tagged DEPOSIT. */
export async function raiseDepositInvoice(projectId: string) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true },
  });
  const pct = project.depositPct ?? 30;
  const amount = Math.round(project.totalValue * (pct / 100) * 100) / 100;
  if (amount <= 0) throw new Error("Set a project total value before raising a deposit.");

  const reference = `${project.title} — Deposit (${pct}%)`;
  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({
    contactId,
    reference,
    lines: [{ description: `Deposit (${pct}%) — ${project.title}`, quantity: 1, unitAmount: amount }],
  });

  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber || reference,
      kind: "DEPOSIT",
      date: new Date(),
      paid: false,
      xeroInvoiceId: xi.InvoiceID,
      xeroNumber: xi.InvoiceNumber ?? null,
      xeroStatus: xi.Status,
      xeroSynced: true,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/* ---------- Services ---------- */

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export async function createService(formData: FormData) {
  await requireUser();
  await prisma.service.create({
    data: {
      name: str(formData, "name"),
      description: str(formData, "description") || null,
      price: parseFloat(str(formData, "price")) || 0,
      unit: str(formData, "unit") || "one-off",
      category: str(formData, "category") || "Other",
    },
  });
  revalidatePath("/settings/services");
}

export async function updateService(id: string, formData: FormData) {
  await requireUser();
  await prisma.service.update({
    where: { id },
    data: {
      name: str(formData, "name"),
      description: str(formData, "description") || null,
      price: parseFloat(str(formData, "price")) || 0,
      unit: str(formData, "unit") || "one-off",
      category: str(formData, "category") || "Other",
      active: formData.get("active") === "on",
    },
  });
  revalidatePath("/settings/services");
}

export async function deleteService(id: string) {
  await requireUser();
  await prisma.service.delete({ where: { id } });
  revalidatePath("/settings/services");
}
