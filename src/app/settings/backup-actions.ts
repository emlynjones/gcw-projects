"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { importBackup } from "@/lib/backup";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorised");
}

export async function importBackupAction(formData: FormData) {
  await requireUser();

  const file = formData.get("backupFile");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/settings?importError=nofile");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    redirect("/settings?importError=badjson");
  }

  const summary = await importBackup(parsed);
  const params = new URLSearchParams({
    importOk: "1",
    created: String(summary.created),
    updated: String(summary.updated),
    skipped: String(summary.skipped),
  });
  if (summary.warnings.length) params.set("warnings", summary.warnings.join(" | "));
  redirect(`/settings?${params.toString()}`);
}
