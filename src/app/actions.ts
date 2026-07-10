"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isStageFor, isProjectType, isInvoiceKind, canMarkLost, LOST } from "@/lib/status";
import { importOneXeroContact } from "@/app/xero-actions";
import { saveUpload, deleteUpload } from "@/lib/files";

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
const optNum = (fd: FormData, key: string) => {
  const s = str(fd, key);
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
// Accepts "2026-07" (month input) or "2026-07-08" (date input); month → 1st.
const optDate = (fd: FormData, key: string) => {
  const s = str(fd, key);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
  return isNaN(d.getTime()) ? null : d;
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
  const type = isProjectType(str(formData, "type")) ? str(formData, "type") : "PROJECT";
  const stage = str(formData, "stage");
  const project = await prisma.project.create({
    data: {
      title: str(formData, "title"),
      clientId: str(formData, "clientId"),
      type,
      stage: isStageFor(type, stage) ? stage : "ENQUIRY",
      totalValue: num(formData, "totalValue"),
      description: opt(formData, "description"),
      startDate: optDate(formData, "startDate"),
      targetDate: optDate(formData, "targetDate"),
      hoursQuoted: optNum(formData, "hoursQuoted"),
      proposalUrl: opt(formData, "proposalUrl"),
    },
  });
  // Full projects get standard hosting + domain by default; easy to remove later.
  if (type === "PROJECT" && str(formData, "skipStandardServices") !== "on") {
    await addStandardServicesFor(project.id);
  }
  revalidatePath("/projects");
  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

export async function updateProject(id: string, formData: FormData) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  const type = isProjectType(str(formData, "type")) ? str(formData, "type") : project.type;
  const stage = str(formData, "stage");
  await prisma.project.update({
    where: { id },
    data: {
      title: str(formData, "title"),
      clientId: str(formData, "clientId"),
      type,
      totalValue: num(formData, "totalValue"),
      depositPct: num(formData, "depositPct"),
      stage: isStageFor(type, stage) ? stage : undefined,
      startDate: optDate(formData, "startDate"),
      targetDate: optDate(formData, "targetDate"),
      completedDate: optDate(formData, "completedDate"),
      hoursQuoted: optNum(formData, "hoursQuoted"),
      hoursDone: optNum(formData, "hoursDone"),
      description: opt(formData, "description"),
      proposalUrl: opt(formData, "proposalUrl"),
    },
  });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

/** Save the brief (free text) and/or site structure text; optional structure approval. */
export async function updateProjectDocs(id: string, formData: FormData) {
  await requireUser();
  await prisma.project.update({
    where: { id },
    data: {
      briefText: opt(formData, "briefText"),
      siteStructure: opt(formData, "siteStructure"),
    },
  });
  revalidatePath(`/projects/${id}`);
}

export async function setStructureApproved(id: string, approved: boolean) {
  await requireUser();
  await prisma.project.update({ where: { id }, data: { structureApproved: approved } });
  revalidatePath(`/projects/${id}`);
}

/** Move a project to a specific stage on its track (advance buttons, stage select). */
export async function setProjectStage(id: string, stage: string) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  if (!isStageFor(project.type, stage)) throw new Error(`Invalid stage ${stage} for ${project.type}`);
  if (stage === LOST && !canMarkLost(project.stage)) throw new Error("Only enquiries can be marked lost");
  // Reaching LIVE records the actual completion date (for duration reporting) unless already set.
  const completedDate = stage === "LIVE" && !project.completedDate ? new Date() : undefined;
  await prisma.project.update({ where: { id }, data: { stage, completedDate } });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

/** Form wrapper for setProjectStage — used by the "move to stage" select. */
export async function setProjectStageFromForm(id: string, formData: FormData) {
  await setProjectStage(id, str(formData, "stage"));
}

export async function setProjectArchived(id: string, archived: boolean) {
  await requireUser();
  await prisma.project.update({ where: { id }, data: { archived } });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

/** Quick inline "log hours" on ad-hoc jobs — updates hoursDone only. */
export async function logHours(id: string, formData: FormData) {
  await requireUser();
  await prisma.project.update({ where: { id }, data: { hoursDone: optNum(formData, "hoursDone") } });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/");
}

export async function deleteProject(id: string) {
  await requireUser();
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  revalidatePath("/");
  redirect("/projects");
}

/* ---------- Bulk add / edit ---------- */

/** Resolve a bulk-form client value: local id, "xero:<contactId>" (import), or "" → null. */
async function resolveClientId(value: string): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("xero:")) {
    const client = await importOneXeroContact(value.slice(5));
    return client.id;
  }
  return value;
}

/**
 * Bulk-create projects. Rows are parallel arrays (title[], clientId[], start[],
 * end[]); rows with an empty title are skipped. Projects without a client get
 * a placeholder "— Unassigned —" client so the schema relation holds.
 */
export async function bulkCreateProjects(formData: FormData) {
  await requireUser();
  const titles = formData.getAll("title").map(String);
  const clientIds = formData.getAll("clientId").map(String);
  const starts = formData.getAll("start").map(String);
  const ends = formData.getAll("end").map(String);
  const stages = formData.getAll("stage").map(String);

  let unassignedId: string | null = null;
  const getUnassigned = async () => {
    if (unassignedId) return unassignedId;
    const existing =
      (await prisma.client.findFirst({ where: { name: "— Unassigned —" } })) ??
      (await prisma.client.create({ data: { name: "— Unassigned —" } }));
    unassignedId = existing.id;
    return unassignedId;
  };

  const parseMonth = (s: string) => {
    if (!s) return null;
    const d = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
    return isNaN(d.getTime()) ? null : d;
  };

  let created = 0;
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i].trim();
    if (!title) continue;
    const clientId = (await resolveClientId(clientIds[i] ?? "")) ?? (await getUnassigned());
    const stage = stages[i] ?? "";
    await prisma.project.create({
      data: {
        title,
        clientId,
        type: "PROJECT",
        stage: isStageFor("PROJECT", stage) ? stage : "ONBOARDING",
        startDate: parseMonth(starts[i] ?? ""),
        targetDate: parseMonth(ends[i] ?? ""),
      },
    });
    created++;
  }
  revalidatePath("/projects");
  revalidatePath("/");
  redirect(created ? "/projects" : "/projects/bulk");
}

/** Bulk-edit: one row per project id, fields suffixed __<id>. */
export async function bulkUpdateProjects(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("id").map(String);
  for (const id of ids) {
    const get = (k: string) => str(formData, `${k}__${id}`);
    const title = get("title");
    if (!title) continue;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) continue;
    const stage = get("stage");
    const clientId = await resolveClientId(get("clientId"));
    const parse = (s: string) => {
      if (!s) return null;
      const d = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
      return isNaN(d.getTime()) ? null : d;
    };
    await prisma.project.update({
      where: { id },
      data: {
        title,
        clientId: clientId ?? undefined,
        stage: isStageFor(project.type, stage) ? stage : undefined,
        startDate: parse(get("start")),
        targetDate: parse(get("end")),
        totalValue: num(formData, `value__${id}`),
        archived: formData.get(`archived__${id}`) === "on",
      },
    });
  }
  revalidatePath("/projects");
  revalidatePath("/");
  redirect("/projects");
}

/* ---------- Dev sites ---------- */

export async function addDevSite(projectId: string, formData: FormData) {
  await requireUser();
  const url = str(formData, "url");
  if (!url) return;
  await prisma.devSite.create({
    data: { projectId, url, label: opt(formData, "label"), approved: false },
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Mark one dev site as the approved one (clears the flag on the project's others). */
export async function approveDevSite(id: string, projectId: string) {
  await requireUser();
  await prisma.devSite.updateMany({ where: { projectId }, data: { approved: false } });
  await prisma.devSite.update({ where: { id }, data: { approved: true } });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteDevSite(id: string, projectId: string) {
  await requireUser();
  await prisma.devSite.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`);
}

/* ---------- Files (proposal / brief / other) ---------- */

export async function uploadProjectFile(projectId: string, formData: FormData) {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const kindRaw = str(formData, "kind");
  const kind = ["PROPOSAL", "BRIEF", "OTHER"].includes(kindRaw) ? kindRaw : "OTHER";
  const saved = await saveUpload(projectId, file);
  await prisma.projectFile.create({
    data: {
      projectId,
      kind,
      filename: saved.filename,
      path: saved.path,
      mime: saved.mime,
      size: saved.size,
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProjectFile(id: string, projectId: string) {
  await requireUser();
  const file = await prisma.projectFile.findUnique({ where: { id } });
  if (file) {
    await deleteUpload(file.path);
    await prisma.projectFile.delete({ where: { id } });
  }
  revalidatePath(`/projects/${projectId}`);
}

/* ---------- Project services (basis for the final invoice) ---------- */

/** Add hosting + domain from the price list (by name match) or sensible defaults. */
export async function addStandardServicesFor(projectId: string) {
  const wanted = [
    { match: /hosting/i, fallback: { name: "Standard hosting", unit: "year", price: 120 } },
    { match: /domain/i, fallback: { name: "Domain name", unit: "year", price: 15 } },
  ];
  const services = await prisma.service.findMany({ where: { active: true } });
  let order = 0;
  for (const w of wanted) {
    const svc = services.find((s) => w.match.test(s.name));
    await prisma.projectService.create({
      data: {
        projectId,
        serviceId: svc?.id ?? null,
        name: svc?.name ?? w.fallback.name,
        unit: svc?.unit ?? w.fallback.unit,
        price: svc?.price ?? w.fallback.price,
        quantity: 1,
        sortOrder: order++,
      },
    });
  }
}

/** Add a service line to a project — from the price list (serviceId) or a custom entry. */
export async function addProjectService(projectId: string, formData: FormData) {
  await requireUser();
  const serviceId = opt(formData, "serviceId");
  const count = await prisma.projectService.count({ where: { projectId } });
  if (serviceId) {
    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) return;
    await prisma.projectService.create({
      data: {
        projectId,
        serviceId: svc.id,
        name: svc.name,
        unit: svc.unit,
        price: svc.price,
        quantity: optNum(formData, "quantity") ?? 1,
        sortOrder: count,
      },
    });
  } else {
    const name = str(formData, "name");
    if (!name) return;
    await prisma.projectService.create({
      data: {
        projectId,
        name,
        unit: str(formData, "unit") || "one-off",
        price: num(formData, "price"),
        quantity: optNum(formData, "quantity") ?? 1,
        sortOrder: count,
      },
    });
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectService(id: string, projectId: string, formData: FormData) {
  await requireUser();
  await prisma.projectService.update({
    where: { id },
    data: {
      name: str(formData, "name"),
      unit: str(formData, "unit") || "one-off",
      price: num(formData, "price"),
      quantity: optNum(formData, "quantity") ?? 1,
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProjectService(id: string, projectId: string) {
  await requireUser();
  await prisma.projectService.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}`);
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
    data: {
      projectId,
      author: user.name ?? user.email ?? "Unknown",
      body,
      timestamp: optDate(formData, "timestamp") ?? new Date(),
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Edit a note's body and/or its display timestamp (backdating a call, etc.). */
export async function updateNote(id: string, projectId: string, formData: FormData) {
  await requireUser();
  const body = str(formData, "body");
  if (!body) return;
  await prisma.note.update({
    where: { id },
    data: { body, timestamp: optDate(formData, "timestamp") ?? undefined },
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
