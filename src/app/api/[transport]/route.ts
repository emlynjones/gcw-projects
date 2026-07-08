/**
 * MCP server — exposed at /api/mcp (streamable HTTP).
 * Auth: Authorization: Bearer <MCP_API_KEY>
 */
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  PROJECT_TYPES,
  ADHOC_STAGES,
  PROJECT_STAGES,
  LIFECYCLES,
  LOST,
  isStageFor,
  lifecycleOf,
} from "@/lib/status";

const typeEnum = z.enum(PROJECT_TYPES);
const lifecycleEnum = z.enum(LIFECYCLES);
const stageEnum = z.enum([...new Set([...ADHOC_STAGES, ...PROJECT_STAGES, LOST])] as [string, ...string[]]);

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const handler = createMcpHandler(
  (server) => {
    /* ---------- Clients ---------- */
    server.tool(
      "list_clients",
      "List all clients with project counts.",
      {},
      async () => {
        const clients = await prisma.client.findMany({
          include: { _count: { select: { projects: true } } },
          orderBy: { name: "asc" },
        });
        return json(clients);
      }
    );

    server.tool(
      "create_client",
      "Create a new client.",
      {
        name: z.string().min(1),
        contactName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      },
      async (args) => json(await prisma.client.create({ data: args }))
    );

    server.tool(
      "update_client",
      "Update a client's details. Only supplied fields are changed.",
      {
        id: z.string(),
        name: z.string().optional(),
        contactName: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
      },
      async ({ id, ...data }) => json(await prisma.client.update({ where: { id }, data }))
    );

    server.tool(
      "delete_client",
      "Delete a client (fails if they have projects).",
      { id: z.string() },
      async ({ id }) => {
        const count = await prisma.project.count({ where: { clientId: id } });
        if (count > 0) return json({ error: `Client has ${count} project(s) — cannot delete.` });
        await prisma.client.delete({ where: { id } });
        return json({ deleted: id });
      }
    );

    /* ---------- Projects ---------- */
    server.tool(
      "list_projects",
      "List projects, optionally filtered by stage, lifecycle (derived: ENQUIRY/ACTIVE/COMPLETE/LOST/ARCHIVED) or type (PROJECT/ADHOC). Includes client name and invoiced/left totals.",
      {
        stage: stageEnum.optional(),
        lifecycle: lifecycleEnum.optional(),
        type: typeEnum.optional(),
        includeArchived: z.boolean().optional().describe("Include archived projects (default false)"),
      },
      async ({ stage, lifecycle, type, includeArchived }) => {
        const projects = await prisma.project.findMany({
          where: {
            ...(stage ? { stage } : {}),
            ...(type ? { type } : {}),
            ...(includeArchived || lifecycle === "ARCHIVED" ? {} : { archived: false }),
          },
          include: { client: { select: { name: true } }, invoices: true },
          orderBy: { updatedAt: "desc" },
        });
        return json(
          projects
            .map((p) => ({ ...p, lifecycle: lifecycleOf(p) }))
            .filter((p) => !lifecycle || p.lifecycle === lifecycle)
            .map((p) => {
              const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
              return {
                id: p.id,
                title: p.title,
                client: p.client.name,
                clientId: p.clientId,
                type: p.type,
                stage: p.stage,
                lifecycle: p.lifecycle,
                archived: p.archived,
                startDate: p.startDate,
                targetDate: p.targetDate,
                hoursQuoted: p.hoursQuoted,
                hoursDone: p.hoursDone,
                totalValueExVat: p.totalValue,
                invoiced,
                leftToInvoice: p.totalValue - invoiced,
                proposalUrl: p.proposalUrl,
                updatedAt: p.updatedAt,
              };
            })
        );
      }
    );

    server.tool(
      "get_project",
      "Get full project detail: invoices, notes, attachments, client.",
      { id: z.string() },
      async ({ id }) => {
        const p = await prisma.project.findUnique({
          where: { id },
          include: {
            client: true,
            invoices: { orderBy: { date: "asc" } },
            notes: { orderBy: { timestamp: "desc" } },
            attachments: true,
          },
        });
        if (!p) return json({ error: "Project not found" });
        const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
        return json({ ...p, invoiced, leftToInvoice: p.totalValue - invoiced });
      }
    );

    server.tool(
      "create_project",
      "Create a project for a client. totalValue is ex-VAT. Type PROJECT stages: ENQUIRY→QUOTED→ONBOARDING→…→LIVE; type ADHOC: ENQUIRY→QUOTED→DOING→DONE→INVOICED. LOST is a terminal branch from ENQUIRY/QUOTED.",
      {
        title: z.string().min(1),
        clientId: z.string(),
        type: typeEnum.default("PROJECT"),
        stage: stageEnum.default("ENQUIRY"),
        totalValue: z.number().nonnegative().default(0),
        startDate: z.string().optional().describe("ISO date"),
        targetDate: z.string().optional().describe("ISO date — expected finish"),
        hoursQuoted: z.number().nonnegative().optional(),
        proposalUrl: z.string().optional(),
      },
      async ({ startDate, targetDate, ...args }) => {
        if (!isStageFor(args.type, args.stage))
          return json({ error: `Stage ${args.stage} is not valid for type ${args.type}` });
        return json(
          await prisma.project.create({
            data: {
              ...args,
              startDate: startDate ? new Date(startDate) : undefined,
              targetDate: targetDate ? new Date(targetDate) : undefined,
            },
          })
        );
      }
    );

    server.tool(
      "update_project",
      "Update a project (title, client, value, stage, dates, hours, archived, proposal URL). Only supplied fields change.",
      {
        id: z.string(),
        title: z.string().optional(),
        clientId: z.string().optional(),
        totalValue: z.number().nonnegative().optional(),
        stage: stageEnum.optional(),
        archived: z.boolean().optional(),
        startDate: z.string().nullable().optional().describe("ISO date, null clears"),
        targetDate: z.string().nullable().optional().describe("ISO date, null clears"),
        hoursQuoted: z.number().nonnegative().nullable().optional(),
        hoursDone: z.number().nonnegative().nullable().optional(),
        proposalUrl: z.string().nullable().optional(),
      },
      async ({ id, stage, startDate, targetDate, ...data }) => {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project) return json({ error: "Project not found" });
        if (stage && !isStageFor(project.type, stage))
          return json({ error: `Stage ${stage} is not valid for type ${project.type}` });
        return json(
          await prisma.project.update({
            where: { id },
            data: {
              ...data,
              ...(stage ? { stage } : {}),
              ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
              ...(targetDate !== undefined ? { targetDate: targetDate ? new Date(targetDate) : null } : {}),
            },
          })
        );
      }
    );

    server.tool(
      "delete_project",
      "Delete a project and all its invoices, notes and attachments.",
      { id: z.string() },
      async ({ id }) => {
        await prisma.project.delete({ where: { id } });
        return json({ deleted: id });
      }
    );

    /* ---------- Invoices ---------- */
    server.tool(
      "add_invoice",
      "Add an invoice to a project. Amount is ex-VAT. Date defaults to today (ISO format).",
      {
        projectId: z.string(),
        amount: z.number(),
        reference: z.string(),
        date: z.string().optional().describe("ISO date, e.g. 2026-07-03"),
        paid: z.boolean().default(false),
      },
      async ({ projectId, amount, reference, date, paid }) =>
        json(
          await prisma.invoice.create({
            data: { projectId, amount, reference, paid, date: date ? new Date(date) : new Date() },
          })
        )
    );

    server.tool(
      "update_invoice",
      "Update an invoice (amount, reference, date, paid).",
      {
        id: z.string(),
        amount: z.number().optional(),
        reference: z.string().optional(),
        date: z.string().optional(),
        paid: z.boolean().optional(),
      },
      async ({ id, date, ...rest }) =>
        json(
          await prisma.invoice.update({
            where: { id },
            data: { ...rest, ...(date ? { date: new Date(date) } : {}) },
          })
        )
    );

    server.tool(
      "delete_invoice",
      "Delete an invoice.",
      { id: z.string() },
      async ({ id }) => {
        await prisma.invoice.delete({ where: { id } });
        return json({ deleted: id });
      }
    );

    /* ---------- Notes ---------- */
    server.tool(
      "add_note",
      "Add a note to a project. timestamp (ISO) is the display date — defaults to now, can be backdated.",
      {
        projectId: z.string(),
        body: z.string().min(1),
        author: z.string().default("MCP"),
        timestamp: z.string().optional().describe("ISO datetime — defaults to now"),
      },
      async ({ timestamp, ...args }) =>
        json(
          await prisma.note.create({
            data: { ...args, ...(timestamp ? { timestamp: new Date(timestamp) } : {}) },
          })
        )
    );

    server.tool(
      "delete_note",
      "Delete a note.",
      { id: z.string() },
      async ({ id }) => {
        await prisma.note.delete({ where: { id } });
        return json({ deleted: id });
      }
    );

    /* ---------- Attachments ---------- */
    server.tool(
      "add_attachment",
      "Add an external link attachment (SharePoint etc.) to a project.",
      { projectId: z.string(), label: z.string(), url: z.string() },
      async (args) => json(await prisma.attachment.create({ data: args }))
    );

    server.tool(
      "delete_attachment",
      "Delete an attachment link.",
      { id: z.string() },
      async ({ id }) => {
        await prisma.attachment.delete({ where: { id } });
        return json({ deleted: id });
      }
    );

    /* ---------- Services ---------- */
    server.tool(
      "list_services",
      "GCW service price list (ex-VAT) — used as invoice line items.",
      { category: z.string().optional(), activeOnly: z.boolean().default(true) },
      async ({ category, activeOnly }) =>
        json(
          await prisma.service.findMany({
            where: { ...(category ? { category } : {}), ...(activeOnly ? { active: true } : {}) },
            orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
          })
        )
    );

    /* ---------- Reporting ---------- */
    server.tool(
      "dashboard_summary",
      "Pipeline value (enquiry-phase), left-to-invoice (active work), invoiced-unpaid total, and active counts by type.",
      {},
      async () => {
        const projects = (
          await prisma.project.findMany({ where: { archived: false }, include: { invoices: true } })
        ).map((p) => ({ ...p, lifecycle: lifecycleOf(p) }));
        const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
        const pipelineValue = sum(projects.filter((p) => p.lifecycle === "ENQUIRY").map((p) => p.totalValue));
        const activeProjects = projects.filter((p) => p.lifecycle === "ACTIVE");
        const leftToInvoice = sum(
          activeProjects.map((p) => Math.max(0, p.totalValue - sum(p.invoices.map((i) => i.amount))))
        );
        const invoicedUnpaid = sum(
          projects.flatMap((p) => p.invoices).filter((i) => !i.paid).map((i) => i.amount)
        );
        return json({
          currency: "GBP",
          exVat: true,
          pipelineValue,
          leftToInvoice,
          invoicedUnpaid,
          activeProjectCount: activeProjects.filter((p) => p.type === "PROJECT").length,
          activeAdhocCount: activeProjects.filter((p) => p.type === "ADHOC").length,
        });
      }
    );
  },
  {},
  { basePath: "/api" }
);

function authed(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const key = process.env.MCP_API_KEY;
  return !!key && header === `Bearer ${key}`;
}

const withAuth = (req: Request) => {
  if (!authed(req)) {
    return new Response(JSON.stringify({ error: "Unauthorised — Bearer API key required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(req);
};

export { withAuth as GET, withAuth as POST, withAuth as DELETE };
