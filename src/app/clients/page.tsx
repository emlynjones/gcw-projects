import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ClientsTable from "./ClientsTable";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    include: { _count: { select: { projects: true, websites: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <div className="page-head">
        <h1>Clients</h1>
        <Link href="/clients/new" className="btn">
          + New client
        </Link>
      </div>

      <ClientsTable clients={clients} />
    </>
  );
}
