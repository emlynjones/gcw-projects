import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import NewClientForm from "./NewClientForm";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const conn = await getConnection();
  let xeroContacts: XeroContactLite[] = [];
  if (conn) {
    try {
      xeroContacts = await getUnlinkedXeroContacts();
    } catch {
      // Xero unreachable or rate limited — creating a client by hand still works.
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>New client</h1>
      </div>
      <NewClientForm xeroConnected={!!conn} xeroContacts={xeroContacts} />
    </>
  );
}
