import { auth } from "@/auth";
import { exportBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorised", { status: 401 });

  const backup = await exportBackup();
  const stamp = backup.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="gcw-projects-backup-${stamp}.json"`,
    },
  });
}
