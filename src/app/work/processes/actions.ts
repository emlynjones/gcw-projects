"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { z } from "zod";
import { requireWorkUser } from "@/modules/work/access";
import {
  saveProcessDraft, archiveProcess, applyProcess, dismissProcess,
  saveWorkType, setProjectWorkType, updateAppliedProcess,
} from "@/modules/work/processes";

export type ProcessResult = { error?: string; saved?: string; id?: string };
const errorMessage = (error: unknown) => error instanceof ZodError
  ? error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
  : error instanceof Error ? error.message : "Unable to save. Please try again.";
const refresh = (projectId?: string) => {
  revalidatePath("/work/processes");
  revalidatePath("/work");
  if (projectId) revalidatePath(`/projects/${projectId}`);
};

export async function saveProcessAction(input: unknown, publish: boolean): Promise<ProcessResult> {
  try {
    const actor = await requireWorkUser();
    const id = await saveProcessDraft(input, actor.id, z.boolean().parse(publish));
    refresh();
    return { id, saved: publish ? "Version published" : "Draft saved" };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function archiveProcessAction(id: string, version: number, archived: boolean): Promise<ProcessResult> {
  try {
    await requireWorkUser();
    const value = z.object({ id: z.string().min(1), version: z.number().int().min(0), archived: z.boolean() }).parse({ id, version, archived });
    await archiveProcess(value.id, value.version, value.archived);
    refresh();
    return { saved: archived ? "Group archived" : "Group restored" };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function applyProcessAction(input: unknown): Promise<ProcessResult> {
  try {
    const actor = await requireWorkUser();
    const result = await applyProcess(input, actor.id);
    const projectId = z.object({ projectId: z.string() }).parse(input).projectId;
    refresh(projectId);
    return { id: result.id, saved: result.alreadyApplied ? "This template copy was already applied. No duplicate tasks created." : `Created ${result.created} tasks` };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function dismissProcessAction(projectId: string, templateId: string): Promise<ProcessResult> {
  try {
    await requireWorkUser();
    await dismissProcess(projectId, templateId);
    refresh(projectId);
    return { saved: "Suggestion dismissed" };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function saveWorkTypeAction(input: unknown): Promise<ProcessResult> {
  try {
    await requireWorkUser();
    await saveWorkType(input);
    refresh();
    return { saved: "Work type saved" };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function setWorkTypeAction(projectId: string, workTypeId: string | null): Promise<ProcessResult> {
  try {
    await requireWorkUser();
    await setProjectWorkType(projectId, workTypeId);
    refresh(projectId);
    return { saved: "Work type saved" };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function updateProcessAction(input: unknown): Promise<ProcessResult> {
  try {
    const actor = await requireWorkUser();
    const result = await updateAppliedProcess(input, actor.id);
    refresh(z.object({ projectId: z.string() }).parse(input).projectId);
    return { saved: `Added ${result.added} tasks; reviewed ${result.reviewed} fields` };
  } catch (error) { return { error: errorMessage(error) }; }
}
