import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getConnection, getUnlinkedXeroContacts } from "@/lib/xero";
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

  const [unlinked, linkedCount] = await Promise.all([
    getUnlinkedXeroContacts(),
    prisma.client.count({ where: { xeroContactId: { not: null } } }),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Import from Xero</h1>
        <span className="muted small">
          {conn.tenantName} · {unlinked.length + linkedCount} customers · {linkedCount} already linked
        </span>
      </div>

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
