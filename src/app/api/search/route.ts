import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LIMIT = 6;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) {
    return NextResponse.json({ projects: [], websites: [], clients: [] });
  }

  const [projects, websites, clients] = await Promise.all([
    prisma.project.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
          { client: { name: { contains: query } } },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        archived: true,
        client: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    prisma.website.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { url: { contains: query } },
          { client: { name: { contains: query } } },
        ],
      },
      select: {
        id: true,
        name: true,
        url: true,
        client: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    prisma.client.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { contactName: { contains: query } },
          { email: { contains: query } },
          { phone: { contains: query } },
        ],
      },
      select: {
        id: true,
        name: true,
        contactName: true,
        email: true,
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
  ]);

  return NextResponse.json({ projects, websites, clients });
}
