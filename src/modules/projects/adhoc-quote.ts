import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { aiComplete } from "@/lib/ai";

const quoteLine = z.object({
  serviceId: z.string().min(1),
  quantity: z.number().finite().positive().max(1000),
});
const quoteTask = z.object({
  title: z.string().trim().min(1).max(200),
  estimatedHours: z.number().finite().min(0.25).max(1000).multipleOf(0.25),
});
const quoteInput = z.object({
  projectId: z.string().min(1),
  lines: z.array(quoteLine).min(1).max(12),
  tasks: z.array(quoteTask).min(1).max(6),
});
const aiTasks = z.array(quoteTask).min(1).max(5);

export async function saveAdhocQuote(input: unknown) {
  const value = quoteInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: value.projectId },
      include: { services: true, invoices: { select: { id: true } }, tasks: { select: { title: true } } },
    });
    if (!project || project.archived || project.type !== "ADHOC")
      throw new Error("Choose an active ad-hoc job.");
    if (project.invoices.length) throw new Error("An invoiced job cannot be rebuilt as a quote.");
    if (project.services.length) throw new Error("This job already has saved quote lines.");

    const serviceIds = [...new Set(value.lines.map((line) => line.serviceId))];
    const catalogue = await tx.service.findMany({ where: { id: { in: serviceIds }, active: true } });
    if (catalogue.length !== serviceIds.length) throw new Error("One or more catalogue services are unavailable.");
    const byId = new Map(catalogue.map((service) => [service.id, service]));
    let totalValue = 0;
    for (const [sortOrder, line] of value.lines.entries()) {
      const service = byId.get(line.serviceId)!;
      totalValue += service.price * line.quantity;
      await tx.projectService.create({
        data: {
          projectId: project.id,
          serviceId: service.id,
          name: service.name,
          unit: service.unit,
          price: service.price,
          quantity: line.quantity,
          sortOrder,
          xeroItemCode: service.xeroItemCode,
        },
      });
    }

    const existing = new Set(project.tasks.map((task) => task.title.trim().toLowerCase()));
    for (const task of value.tasks) {
      if (existing.has(task.title.toLowerCase())) continue;
      existing.add(task.title.toLowerCase());
      await tx.task.create({
        data: { projectId: project.id, title: task.title, estimatedHours: task.estimatedHours },
      });
    }
    const hoursQuoted = value.tasks.reduce((sum, task) => sum + task.estimatedHours, 0);
    await tx.project.update({
      where: { id: project.id },
      data: {
        totalValue: Math.round(totalValue * 100) / 100,
        hoursQuoted: Math.round(hoursQuoted * 100) / 100,
        stage: project.stage === "ENQUIRY" ? "QUOTED" : undefined,
      },
    });
    return { totalValue, hoursQuoted, tasksCreated: value.tasks.length };
  });
}

export async function suggestAdhocQuoteTasks(projectId: string, serviceIds: unknown) {
  const ids = z.array(z.string().min(1)).min(1).max(12).parse(serviceIds);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true, description: true, type: true, archived: true },
  });
  if (!project || project.archived || project.type !== "ADHOC") throw new Error("Choose an active ad-hoc job.");
  const services = await prisma.service.findMany({
    where: { id: { in: [...new Set(ids)] }, active: true },
    select: { name: true, description: true },
  });
  const response = await aiComplete(
    "Create a very small, achievable delivery task list for an ad-hoc web-agency quote. Return only JSON: an array of 1 to 5 objects with title and estimatedHours. Use the fewest independently completable tasks possible. Do not add meetings, admin, documentation, deployment, testing or review unless the supplied scope explicitly requires it. Titles must be imperative and under 200 characters. estimatedHours must be a realistic number in quarter-hour increments.",
    JSON.stringify({ job: project.title, details: project.description, quotedServices: services }),
    500,
  );
  try {
    const unwrapped = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return aiTasks.parse(JSON.parse(unwrapped));
  } catch {
    throw new Error("AI returned an unreadable task list. Please try again.");
  }
}
