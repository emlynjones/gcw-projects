"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { saveAdhocQuote, suggestAdhocQuoteTasks } from "@/modules/projects/adhoc-quote";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
}
const message = (error: unknown) => error instanceof Error ? error.message : "Unable to build the quote.";

export async function saveAdhocQuoteAction(input: unknown) {
  try {
    await requireUser();
    const result = await saveAdhocQuote(input);
    const projectId = typeof input === "object" && input && "projectId" in input ? String(input.projectId) : "";
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/work");
    return { saved: true as const, ...result };
  } catch (error) {
    return { saved: false as const, error: message(error) };
  }
}

export async function suggestAdhocQuoteTasksAction(projectId: string, serviceIds: string[]) {
  try {
    await requireUser();
    return { tasks: await suggestAdhocQuoteTasks(projectId, serviceIds) };
  } catch (error) {
    return { error: message(error) };
  }
}
