"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isInvoiceKind } from "@/lib/status";
import {
  feeRemainder,
  remainderDescription,
  serviceLines,
  PROJECT_FEE_ITEM_CODE,
  adhocItemCode,
} from "@/lib/invoicing";
import { adhocDescription, projectFeeDescription } from "@/lib/invoice-descriptions";
import {
  disconnect,
  getCustomers,
  getInvoicesByIds,
  createDraftInvoice,
  parseXeroDate,
  type InvoiceLine,
} from "@/lib/xero";
import {
  ensureXeroContactForClient,
  importXeroContact,
  upsertClientFromXeroContact,
} from "@/modules/accounting/xero/contacts";

type ProjectWithClient = {
  id: string;
  title: string;
  clientId: string;
  client: { name: string; email: string | null; contactName: string | null; phone: string | null; xeroContactId: string | null };
};

/** Ensure the project's client exists in Xero, returning the contact id. */
async function ensureXeroContactId(project: ProjectWithClient): Promise<string> {
  return ensureXeroContactForClient({ ...project.client, id: project.clientId });
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
  const client = await importXeroContact(contactId);
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
export async function raiseAdhocInvoice(projectId: string, formData?: FormData) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true },
  });
  if (project.totalValue <= 0) throw new Error("Set the project amount before invoicing.");

  const hours = project.hoursDone ?? project.hoursQuoted;
  // The most recent note is usually the closest record of what was actually
  // done, so it's the last fallback before dropping back to the bare title.
  const latestNote = await prisma.note.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  const description = adhocDescription({
    title: project.title,
    description: project.description,
    briefText: project.briefText,
    latestNote: latestNote?.body ?? null,
    hours,
  });
  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({
    contactId,
    reference: project.title,
    lines: [
      {
        description,
        quantity: 1,
        unitAmount: project.totalValue,
        // Not the project fee item: an ad-hoc job is general or technical
        // website work, and the picker on the raise form says which.
        itemCode: adhocItemCode(formData?.get("itemCode")?.toString()),
      },
    ],
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

  // The payload arrives from the browser, so an item code could be anything.
  // Xero rejects an unknown code with a validation error that says little about
  // which line caused it, so unknown codes are dropped here instead: the
  // invoice still goes out, it just lands on the default sales account.
  const known = new Set(
    (await prisma.xeroItem.findMany({ select: { code: true } })).map((i) => i.code)
  );
  for (const line of valid) {
    if (line.itemCode && !known.has(line.itemCode)) line.itemCode = null;
  }
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

/**
 * Raise the closing DRAFT invoice for a full project — the "invoice at the end" flow.
 *
 * Two independent parts, either of which the form can switch off: the additional
 * services attached to the project, and the balance of the agreed fee left after
 * earlier invoices (the deposit, normally). Billing services alone was the old
 * behaviour and quietly dropped that balance, so a £5k project with a £1.5k
 * deposit and £600 of extras closed at £600 instead of £4,100.
 */
export async function raiseFinalInvoice(projectId: string, formData: FormData) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true, services: { orderBy: { sortOrder: "asc" } }, invoices: true },
  });

  const remainder = feeRemainder(project.totalValue, project.invoices);

  const lines: InvoiceLine[] = [];
  if (formData.get("includeRemainder") === "on" && remainder > 0) {
    lines.push({
      description: remainderDescription(project.title, project.invoices.length > 0),
      quantity: 1,
      unitAmount: remainder,
      itemCode: PROJECT_FEE_ITEM_CODE,
    });
  }
  if (formData.get("includeServices") === "on") {
    lines.push(...serviceLines(project.services));
  }
  if (!lines.length) {
    throw new Error("Nothing to invoice — select the remaining balance, some services, or both.");
  }

  const kind = String(formData.get("kind") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || project.title;
  const contactId = await ensureXeroContactId(project);
  const xi = await createDraftInvoice({ contactId, reference, lines });

  await prisma.invoice.create({
    data: {
      projectId,
      amount: xi.SubTotal,
      reference: xi.InvoiceNumber || reference,
      kind: isInvoiceKind(kind) ? kind : "FINAL",
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
    lines: [
      {
        description: projectFeeDescription(project.title, "DEPOSIT", pct),
        quantity: 1,
        unitAmount: amount,
        itemCode: PROJECT_FEE_ITEM_CODE,
      },
    ],
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
      xeroItemCode: str(formData, "xeroItemCode") || null,
    },
  });
  revalidatePath("/settings/services");
}

export async function updateService(id: string, formData: FormData) {
  await requireUser();
  const before = await prisma.service.findUnique({ where: { id } });
  const updated = await prisma.service.update({
    where: { id },
    data: {
      name: str(formData, "name"),
      description: str(formData, "description") || null,
      price: parseFloat(str(formData, "price")) || 0,
      unit: str(formData, "unit") || "one-off",
      category: str(formData, "category") || "Other",
      xeroItemCode: str(formData, "xeroItemCode") || null,
      active: formData.get("active") === "on",
    },
  });

  // Keep catalogue-priced recurring rows in sync while preserving deliberate
  // client overrides. A row is using the default when its current period price
  // still equals the old catalogue price for its term.
  if (before) {
    const linked = await prisma.recurringService.findMany({
      where: { catalogueServiceId: id },
      select: { id: true, termMonths: true, sellPrice: true },
    });
    const periodPrice = (price: number, unit: string, months: number) =>
      unit === "month" ? price * months : unit === "year" ? price * (months / 12) : price;
    await prisma.recurringService.updateMany({
      where: { catalogueServiceId: id },
      data: { xeroItemCode: updated.xeroItemCode },
    });
    const writes = linked
      .filter(
        (row) =>
          Math.abs(row.sellPrice - periodPrice(before.price, before.unit, row.termMonths || 12)) < 0.01
      )
      .map((row) =>
        prisma.recurringService.update({
          where: { id: row.id },
          data: {
            sellPrice: periodPrice(updated.price, updated.unit, row.termMonths || 12),
          },
        })
      );
    if (writes.length) await prisma.$transaction(writes);
  }
  revalidatePath("/settings/services");
  revalidatePath("/recurring");
  revalidatePath("/recurring/dashboard");
  revalidatePath("/invoices/run");
}

export async function deleteService(id: string) {
  await requireUser();
  await prisma.service.delete({ where: { id } });
  revalidatePath("/settings/services");
}
