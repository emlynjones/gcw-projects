"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isStatus, isProjectType, isInvoiceKind } from "@/lib/status";

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

/* ---------- Clients ---------- */

export async function createClient(formData: FormData) {
  await requireUser();
  const client = await prisma.client.create({
    data: {
      name: str(formData, "name"),
      contactName: opt(formData, "contactName"),
      email: opt(formData, "email"),
      phone: opt(formData, "phone"),
    },
  });
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(id: string, formData: FormData) {
  await requireUser();
  await prisma.client.update({
    where: { id },
    data: {
      name: str(formData, "name"),
      contactName: opt(formData, "contactName"),
      email: opt(formData, "email"),
      phone: opt(formData, "phone"),
    },
  });
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}

export async function deleteClient(id: string) {
  await requireUser();
  const count = await prisma.project.count({ where: { clientId: id } });
  if (count > 0) throw new Error("Client has projects — archive or delete those first.");
  await prisma.client.delete({ where: { id } });
  revalidatePath("/clients");
  redirect("/clients");
}

/* ---------- Projects ---------- */

export async function createProject(formData: FormData) {
  await requireUser();
  const status = str(formData, "status");
  const type = str(formData, "type");
  const project = await prisma.project.create({
    data: {
      title: str(formData, "title"),
      clientId: str(formData, "clientId"),
      type: isProjectType(type) ? type : "WEBSITE",
      totalValue: num(formData, "totalValue"),
      status: isStatus(status) ? status : "ENQUIRY",
      proposalUrl: opt(formData, "proposalUrl"),
    },
  });
  revalidatePath("/projects");
  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

export async function updateProject(id: string, formData: FormData) {
  await requireUser();
  const status = str(formData, "status");
  const type = str(formData, "type");
  await prisma.project.update({
    where: { id },
    data: {
      title: str(formData, "title"),
      clientId: str(formData, "clientId"),
      type: isProjectType(type) ? type : undefined,
      totalValue: num(formData, "totalValue"),
      depositPct: num(formData, "depositPct"),
      status: isStatus(status) ? status : undefined,
      proposalUrl: opt(formData, "proposalUrl"),
    },
  });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function deleteProject(id: string) {
  await requireUser();
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  revalidatePath("/");
  redirect("/projects");
}

/* ---------- Invoices ---------- */

export async function addInvoice(projectId: string, formData: FormData) {
  await requireUser();
  const dateStr = str(formData, "date");
  const kind = str(formData, "kind");
  await prisma.invoice.create({
    data: {
      projectId,
      amount: num(formData, "amount"),
      reference: str(formData, "reference"),
      kind: isInvoiceKind(kind) ? kind : null,
      date: dateStr ? new Date(dateStr) : new Date(),
      paid: formData.get("paid") === "on",
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

/** Tag (or clear) an invoice's role: Deposit / Interim / Final. */
export async function setInvoiceKind(id: string, projectId: string, formData: FormData) {
  await requireUser();
  const kind = str(formData, "kind");
  await prisma.invoice.update({
    where: { id },
    data: { kind: isInvoiceKind(kind) ? kind : null },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function toggleInvoicePaid(id: string, projectId: string) {
  await requireUser();
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  await prisma.invoice.update({ where: { id }, data: { paid: !inv.paid } });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

export async function deleteInvoice(id: string, projectId: string) {
  await requireUser();
  await prisma.invoice.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

/* ---------- Notes ---------- */

export async function addNote(projectId: string, formData: FormData) {
  const user = await requireUser();
  const body = str(formData, "body");
  if (!body) return;
  await prisma.note.create({
    data: { projectId, author: user.name ?? user.email ?? "Unknown", body },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteNote(id: string, projectId: string) {
  await requireUser();
  await prisma.note.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`);
}

/* ---------- Attachments ---------- */

export async function addAttachment(projectId: string, formData: FormData) {
  await requireUser();
  const label = str(formData, "label");
  const url = str(formData, "url");
  if (!label || !url) return;
  await prisma.attachment.create({ data: { projectId, label, url } });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteAttachment(id: string, projectId: string) {
  await requireUser();
  await prisma.attachment.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`);
}
