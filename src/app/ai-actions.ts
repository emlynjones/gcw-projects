"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { saveAiSettings, deleteSetting, AI_API_KEY_ENC, AI_PROVIDER, AI_MODEL } from "@/lib/settings";
import { aiComplete } from "@/lib/ai";
import { stageLabel, stageAction, lifecycleOf, dateFmt } from "@/lib/status";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
  return session.user;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export async function updateAiSettings(formData: FormData) {
  await requireUser();
  const provider = str(formData, "provider");
  const model = str(formData, "model");
  const apiKey = str(formData, "apiKey"); // blank = keep existing
  await saveAiSettings(provider, model, apiKey || null);
  revalidatePath("/settings");
}

export async function clearAiKey() {
  await requireUser();
  await Promise.all([
    deleteSetting(AI_API_KEY_ENC),
    deleteSetting(AI_PROVIDER),
    deleteSetting(AI_MODEL),
  ]);
  revalidatePath("/settings");
}

/**
 * Draft a plain-text site structure from the project's brief/description and
 * save it onto the project (does not auto-approve). Surfaces AI errors.
 */
export async function generateSiteStructure(projectId: string) {
  await requireUser();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true },
  });
  const context = [
    `Client: ${project.client.name}`,
    `Project: ${project.title}`,
    project.description ? `Description: ${project.description}` : "",
    project.briefText ? `Brief:\n${project.briefText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You are a web project planner at a small web agency. Produce a concise, plain-text proposed website " +
    "structure (a sitemap) as an indented bullet list of pages and sub-pages. No preamble, no markdown headings, " +
    "just the outline. Keep it practical for a small business site.";
  const draft = await aiComplete(system, context || `Project: ${project.title}`, 1200);

  await prisma.project.update({ where: { id: projectId }, data: { siteStructure: draft } });
  revalidatePath(`/projects/${projectId}`);
}

/** Build the prompt context + generate a concise "next steps" note for one project. */
async function nextStepsFor(projectId: string): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { client: true, notes: { orderBy: { timestamp: "desc" }, take: 5 } },
  });
  const hint = stageAction(project.type, project.stage).hint;
  const notes = project.notes.length
    ? project.notes.map((n) => `- (${dateFmt(n.timestamp)}) ${n.body}`).join("\n")
    : "No notes yet.";
  const context = [
    `Client: ${project.client.name}`,
    `Project: ${project.title}`,
    `Type: ${project.type === "ADHOC" ? "Ad-hoc job" : "Website project"}`,
    `Current stage: ${stageLabel(project.stage)}`,
    `Standard next step for this stage: ${hint}`,
    project.description ? `Details:\n${project.description}` : "",
    `Recent notes (newest first):\n${notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You are a project manager at a small web agency. Given a project's stage and recent notes, list the " +
    "2–4 concrete next actions to move it forward. Be specific and reference the notes where relevant. " +
    "Output a short plain bullet list only — no preamble, no headings.";
  const steps = await aiComplete(system, context, 500);

  await prisma.project.update({
    where: { id: projectId },
    data: { aiNextSteps: steps, aiNextStepsAt: new Date() },
  });
}

/** Generate/refresh the AI next-steps for a single project. */
export async function generateNextSteps(projectId: string) {
  await requireUser();
  await nextStepsFor(projectId);
  revalidatePath("/reports");
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Generate AI next-steps for all active projects (used by the report). Runs
 * with small concurrency to stay within rate limits; skips failures so one bad
 * call doesn't abort the batch.
 */
export async function generateAllNextSteps() {
  await requireUser();
  const projects = await prisma.project.findMany({ where: { archived: false } });
  const active = projects.filter((p) => {
    const lc = lifecycleOf(p);
    return lc === "ACTIVE" || lc === "ENQUIRY";
  });

  const BATCH = 3;
  for (let i = 0; i < active.length; i += BATCH) {
    await Promise.allSettled(active.slice(i, i + BATCH).map((p) => nextStepsFor(p.id)));
  }
  revalidatePath("/reports");
}
