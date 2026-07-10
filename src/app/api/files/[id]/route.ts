import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorised", { status: 401 });

  const { id } = await params;
  const file = await prisma.projectFile.findUnique({ where: { id } });
  if (!file) return new Response("Not found", { status: 404 });

  try {
    const buf = await readUpload(file.path);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": file.mime || "application/octet-stream",
        "content-disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
        "content-length": String(buf.length),
      },
    });
  } catch {
    return new Response("File missing on disk", { status: 404 });
  }
}
