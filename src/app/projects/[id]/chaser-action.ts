"use server";

import { requireWorkUser } from "@/modules/work/access";
import { draftQuoteChaser } from "@/modules/projects/quote-chaser";

export async function draftQuoteChaserAction(projectId: string, language: "en" | "cy") {
  await requireWorkUser();
  if (language !== "en" && language !== "cy") return { error: "Choose English or Welsh." };
  try {
    return { draft: await draftQuoteChaser(projectId, language) };
  } catch {
    return { error: "Could not draft a chaser. Check the quote and AI settings, then try again." };
  }
}
