import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import { importXeroContacts } from "@/app/xero-actions";

export const dynamic = "force-dynamic";

export default async function XeroImportPage() {
  const conn = await getConnection();
  if (!conn) {
    return (
      <>
        <h1>Import from Xero</h1>
        <div className="card">
          <p className="muted">
            Xero isn&apos;t connected. <Link href="/settings">Connect it in Settings</Link> first.
          </p>
        </div>
      </>
    );
  }

  const linkedCount = await prisma.client.count({ where: { xeroContactId: { not: null } } });
  let unlinked: XeroContactLite[] = [];
  let xeroError: string | null = null;
  try {
    unlinked = await getUnlinkedXeroContacts();
  } catch (e) {
    // Say what happened rather than throwing the whole page away — a rate limit
    // clears on its own, and the message should say so.
    xeroError = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <div className="page-head">
        <h1>Import from Xero</h1>
        <span className="muted small">
          {conn.tenantName} · {unlinked.length + linkedCount} customers · {linkedCount} already linked
        </span>
      </div>

      {xeroError && <div className="error-msg">{xeroError}</div>}

      <div className="card">
        <p className="muted small">
          Tick the contacts to import. Rows marked <strong>“matches existing”</strong> (same email or
          name) will be <em>linked</em> to the existing client rather than duplicated.
        </p>
        <form action={importXeroContacts}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unlinked.map((c) => (
                <tr key={c.contactId}>
                  <td>
                    <input
                      type="checkbox"
                      name="contactId"
                      value={c.contactId}
                      style={{ width: "auto" }}
                    />
                  </td>
                  <td>{c.name}</td>
                  <td>{c.contactName ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>
                    {c.matchesExisting && <span className="badge badge-match">matches existing</span>}
                  </td>
                </tr>
              ))}
              {unlinked.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Every Xero customer is already linked.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {unlinked.length > 0 && (
            <div className="mt">
              <button type="submit" className="btn">
                Import / link selected
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
