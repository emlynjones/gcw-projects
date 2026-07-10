import { prisma } from "@/lib/prisma";
import { getConnection, getUnlinkedXeroContacts } from "@/lib/xero";
import { isProjectType } from "@/lib/status";
import NewProjectForm from "./NewProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const initialType = type && isProjectType(type) ? type : "PROJECT";
  const [clients, conn] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getConnection(),
  ]);
  // Never let a Xero hiccup (e.g. expired token) block project creation — the
  // local client list is enough to create a project.
  let xeroContacts: Awaited<ReturnType<typeof getUnlinkedXeroContacts>> = [];
  if (conn) {
    try {
      xeroContacts = await getUnlinkedXeroContacts();
    } catch {
      xeroContacts = [];
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{initialType === "ADHOC" ? "New ad-hoc job" : "New project"}</h1>
      </div>
      <NewProjectForm
        initialClients={clients}
        xeroConnected={!!conn}
        xeroContacts={xeroContacts}
        initialType={initialType}
      />
    </>
  );
}
