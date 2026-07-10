"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { saveAiSettings, deleteSetting, AI_API_KEY_ENC, AI_PROVIDER, AI_MODEL } from "@/lib/settings";
import { aiComplete } from "@/lib/ai";

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
