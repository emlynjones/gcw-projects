import { prisma } from "@/lib/prisma";

/**
 * Full data backup/restore — clients, projects and everything hung off them.
 * Deliberately excludes: User (login accounts), XeroConnection/Setting (live
 * credentials, tied to this instance's AUTH_SECRET), OAuth client/token
 * tables (security tokens), and ProjectFile (metadata only — the actual
 * uploaded file lives on disk, not in the DB, so importing it would leave a
 * dangling download link).
 */

const COLLECTIONS = [
  "clients",
  "services",
  "projects",
  "devSites",
  "projectServices",
  "invoices",
  "notes",
  "attachments",
] as const;

export type BackupFile = {
  app: "gcw-projects";
  version: 1;
  exportedAt: string;
  data: Record<(typeof COLLECTIONS)[number], unknown[]>;
};

export async function exportBackup(): Promise<BackupFile> {
  const [clients, services, projects, devSites, projectServices, invoices, notes, attachments] =
    await Promise.all([
      prisma.client.findMany(),
      prisma.service.findMany(),
      prisma.project.findMany(),
      prisma.devSite.findMany(),
      prisma.projectService.findMany(),
      prisma.invoice.findMany(),
      prisma.note.findMany(),
      prisma.attachment.findMany(),
    ]);
  return {
    app: "gcw-projects",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { clients, services, projects, devSites, projectServices, invoices, notes, attachments },
  };
}

/* ---------- tolerant field coercion — missing/malformed values become undefined, never throw ---------- */

const str = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
};
const date = (v: unknown): Date | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? undefined : d;
};
const row = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export type ImportSummary = { created: number; updated: number; skipped: number; warnings: string[] };

function rowsOf(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = data[key];
  return Array.isArray(v) ? v.map(row) : [];
}

/** Tolerant restore: accepts a full export, a bare `data` map, or any subset of known collections. */
export async function importBackup(input: unknown): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, warnings: [] };
  const warn = (msg: string) => {
    summary.skipped++;
    if (summary.warnings.length < 20) summary.warnings.push(msg);
  };

  const root = row(input);
  const data = row(root.data && Object.keys(row(root.data)).length ? root.data : root);

  const idSet = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const clientIds = idSet(await prisma.client.findMany({ select: { id: true } }));
  const projectIds = idSet(await prisma.project.findMany({ select: { id: true } }));

  /* ---------- clients ---------- */
  for (const r of rowsOf(data, "clients")) {
    const name = str(r.name);
    if (!name) {
      warn("client: missing name");
      continue;
    }
    const id = str(r.id);
    // Fields left undefined here are omitted from the Prisma call entirely: on
    // create that means "use the schema default / null", on update it means
    // "leave the existing value alone" — never null it out just because a
    // partial import row didn't mention it.
    const fields = {
      name,
      contactName: str(r.contactName),
      email: str(r.email),
      phone: str(r.phone),
      xeroContactId: str(r.xeroContactId),
    };
    if (id && clientIds.has(id)) {
      await prisma.client.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      const created = await prisma.client.create({ data: id ? { id, ...fields } : fields });
      clientIds.add(created.id);
      summary.created++;
    }
  }

  /* ---------- services ---------- */
  const serviceIds = idSet(await prisma.service.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "services")) {
    const name = str(r.name);
    const price = num(r.price);
    const category = str(r.category);
    if (!name || price === undefined || !category) {
      warn(`service "${name ?? "?"}": missing name/price/category`);
      continue;
    }
    const id = str(r.id);
    const fields = {
      name,
      price,
      category,
      description: str(r.description),
      unit: str(r.unit),
      active: bool(r.active),
      sortOrder: num(r.sortOrder),
    };
    if (id && serviceIds.has(id)) {
      await prisma.service.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      const created = await prisma.service.upsert({
        where: { name },
        update: fields,
        create: id ? { id, ...fields } : fields,
      });
      serviceIds.add(created.id);
      summary.created++;
    }
  }

  /* ---------- projects (need clientId to already exist) ---------- */
  for (const r of rowsOf(data, "projects")) {
    const title = str(r.title);
    const clientId = str(r.clientId);
    if (!title || !clientId || !clientIds.has(clientId)) {
      warn(`project "${title ?? "?"}": missing title or unknown clientId`);
      continue;
    }
    const id = str(r.id);
    const fields = {
      title,
      clientId,
      type: str(r.type),
      stage: str(r.stage),
      archived: bool(r.archived),
      totalValue: num(r.totalValue),
      depositPct: num(r.depositPct),
      startDate: date(r.startDate),
      targetDate: date(r.targetDate),
      completedDate: date(r.completedDate),
      hoursQuoted: num(r.hoursQuoted),
      hoursDone: num(r.hoursDone),
      description: str(r.description),
      briefText: str(r.briefText),
      siteStructure: str(r.siteStructure),
      structureApproved: bool(r.structureApproved),
      aiNextSteps: str(r.aiNextSteps),
      aiNextStepsAt: date(r.aiNextStepsAt),
      proposalUrl: str(r.proposalUrl),
    };
    if (id && projectIds.has(id)) {
      await prisma.project.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      const created = await prisma.project.create({ data: id ? { id, ...fields } : fields });
      projectIds.add(created.id);
      summary.created++;
    }
  }

  /* ---------- children of projects ---------- */
  const devSiteIds = idSet(await prisma.devSite.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "devSites")) {
    const projectId = str(r.projectId);
    const url = str(r.url);
    if (!projectId || !projectIds.has(projectId) || !url) {
      warn(`devSite: missing url or unknown projectId`);
      continue;
    }
    const id = str(r.id);
    const fields = { projectId, url, label: str(r.label), approved: bool(r.approved) };
    if (id && devSiteIds.has(id)) {
      await prisma.devSite.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      await prisma.devSite.create({ data: id ? { id, ...fields } : fields });
      summary.created++;
    }
  }

  const projectServiceIds = idSet(await prisma.projectService.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "projectServices")) {
    const projectId = str(r.projectId);
    const name = str(r.name);
    if (!projectId || !projectIds.has(projectId) || !name) {
      warn(`projectService: missing name or unknown projectId`);
      continue;
    }
    const id = str(r.id);
    const fields = {
      projectId,
      name,
      serviceId: str(r.serviceId),
      unit: str(r.unit),
      price: num(r.price),
      quantity: num(r.quantity),
      sortOrder: num(r.sortOrder),
    };
    if (id && projectServiceIds.has(id)) {
      await prisma.projectService.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      await prisma.projectService.create({ data: id ? { id, ...fields } : fields });
      summary.created++;
    }
  }

  const invoiceIds = idSet(await prisma.invoice.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "invoices")) {
    const projectId = str(r.projectId);
    const amount = num(r.amount);
    const reference = str(r.reference);
    if (!projectId || !projectIds.has(projectId) || amount === undefined || !reference) {
      warn(`invoice: missing amount/reference or unknown projectId`);
      continue;
    }
    const id = str(r.id);
    const fields = {
      projectId,
      amount,
      reference,
      kind: str(r.kind),
      date: date(r.date),
      paid: bool(r.paid),
      xeroInvoiceId: str(r.xeroInvoiceId),
      xeroNumber: str(r.xeroNumber),
      xeroStatus: str(r.xeroStatus),
      xeroSynced: bool(r.xeroSynced),
    };
    if (id && invoiceIds.has(id)) {
      await prisma.invoice.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      await prisma.invoice.create({ data: id ? { id, ...fields } : fields });
      summary.created++;
    }
  }

  const noteIds = idSet(await prisma.note.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "notes")) {
    const projectId = str(r.projectId);
    const body = str(r.body);
    const author = str(r.author);
    if (!projectId || !projectIds.has(projectId) || !body || !author) {
      warn(`note: missing body/author or unknown projectId`);
      continue;
    }
    const id = str(r.id);
    const fields = { projectId, body, author, timestamp: date(r.timestamp) };
    if (id && noteIds.has(id)) {
      await prisma.note.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      await prisma.note.create({ data: id ? { id, ...fields } : fields });
      summary.created++;
    }
  }

  const attachmentIds = idSet(await prisma.attachment.findMany({ select: { id: true } }));
  for (const r of rowsOf(data, "attachments")) {
    const projectId = str(r.projectId);
    const label = str(r.label);
    const url = str(r.url);
    if (!projectId || !projectIds.has(projectId) || !label || !url) {
      warn(`attachment: missing label/url or unknown projectId`);
      continue;
    }
    const id = str(r.id);
    const fields = { projectId, label, url };
    if (id && attachmentIds.has(id)) {
      await prisma.attachment.update({ where: { id }, data: fields });
      summary.updated++;
    } else {
      await prisma.attachment.create({ data: id ? { id, ...fields } : fields });
      summary.created++;
    }
  }

  return summary;
}
