import { getConnection, getUnlinkedXeroContacts } from "@/lib/xero";
import NewClientForm from "./NewClientForm";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const conn = await getConnection();
  const xeroContacts = conn ? await getUnlinkedXeroContacts() : [];

  return (
    <>
      <div className="page-head">
        <h1>New client</h1>
      </div>
      <NewClientForm xeroConnected={!!conn} xeroContacts={xeroContacts} />
    </>
  );
}
