"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { saveCapacity, saveTask } from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";

export type WorkResult = { error?: string; saved?: string };
const message = (error: unknown) =>
  error instanceof ZodError
    ? error.issues.map((issue) => issue.message).join("; ")
    : error instanceof Error
      ? error.message
      : "Unable to save. Please try again.";

export async function saveTaskAction(
  _state: WorkResult,
  form: FormData,
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    const result = await saveTask({
      ...Object.fromEntries(form),
      id: String(form.get("id") || "") || undefined,
      dependencyIds: form.getAll("dependencyIds").map(String),
      isMilestone: form.get("isMilestone") === "on",
    });
    revalidatePath("/work");
    revalidatePath(`/projects/${result.projectId}`);
    return { saved: result.id };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function saveCapacityAction(
  _state: WorkResult,
  form: FormData,
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    await saveCapacity(Object.fromEntries(form));
    revalidatePath("/work");
    return { saved: "Capacity saved" };
  } catch (error) {
    return { error: message(error) };
  }
}
