import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    include: { _count: { select: { projects: true } } },
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

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>Email</th>
            <th>Phone</th>
            <th className="num">Projects</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/clients/${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.contactName ?? "—"}</td>
              <td>{c.email ?? "—"}</td>
              <td>{c.phone ?? "—"}</td>
              <td className="num">{c._count.projects}</td>
            </tr>
          ))}
          {clients.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No clients yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
