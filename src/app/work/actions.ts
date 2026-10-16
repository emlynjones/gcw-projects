"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  createTasksFromDetails,
  deleteTask,
  saveCapacity,
  saveTask,
  updateTaskRow,
} from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";

export type WorkResult = { error?: string; saved?: string; version?: number };
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
    return { saved: result.id, version: result.version };
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

const refresh = (projectId: string) => {
  revalidatePath("/work");
  revalidatePath(`/projects/${projectId}`);
};

export async function updateTaskRowAction(
  id: string,
  version: number,
  patch: {
    title?: string;
    status?: string;
    assigneeId?: string;
    dueDate?: string;
  },
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    const result = await updateTaskRow({ id, version, patch });
    refresh(result.projectId);
    return { saved: result.id, version: result.version };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function createTaskRowAction(
  projectId: string,
  row: {
    title: string;
    status: string;
    assigneeId: string;
    dueDate: string;
  },
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    const result = await saveTask({
      projectId,
      ...row,
      priority: "NORMAL",
      estimatedHours: "",
      plannedDate: "",
      sopUrl: "",
    });
    refresh(result.projectId);
    return { saved: result.id, version: result.version };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function deleteTaskAction(
  id: string,
  projectId: string,
  version: number,
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    await deleteTask({ id, projectId, version });
    refresh(projectId);
    return { saved: "Task deleted" };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function convertDetailsToTasksAction(
  projectId: string,
): Promise<WorkResult> {
  try {
    await requireWorkUser();
    const { created, skipped } = await createTasksFromDetails(projectId);
    refresh(projectId);
    return {
      saved: `Created ${created} task${created === 1 ? "" : "s"}${
        skipped ? `, skipped ${skipped} already listed` : ""
      }`,
    };
  } catch (error) {
    return { error: message(error) };
  }
}
