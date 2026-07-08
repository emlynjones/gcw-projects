import Link from "next/link";
import { getConnection, xeroConfigured } from "@/lib/xero";
import { disconnectXero } from "@/app/xero-actions";
import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ xeroConnected?: string; xeroError?: string }>;
}) {
  const { xeroConnected, xeroError } = await searchParams;
  const conn = await getConnection();
  const configured = xeroConfigured();
  const linkedClients = await prisma.client.count({ where: { xeroContactId: { not: null } } });
  const linkedInvoices = await prisma.invoice.count({ where: { xeroInvoiceId: { not: null } } });
  const serviceCount = await prisma.service.count({ where: { active: true } });

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {xeroConnected && <div className="success-msg">Xero connected.</div>}
      {xeroError === "state" && <div className="error-msg">Xero connection failed (state mismatch) — try again.</div>}
      {xeroError === "token" && <div className="error-msg">Xero connection failed at token exchange — check client ID/secret and redirect URI.</div>}
      {xeroError === "notconfigured" && <div className="error-msg">Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in the environment first.</div>}

      <div className="card">
        <h2>Xero</h2>
        {!configured && (
          <p className="muted">
            Not configured. Add <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code> to the
            environment (create the app at developer.xero.com), then restart.
          </p>
        )}
        {configured && !conn && (
          <>
            <p className="muted">Not connected.</p>
            <a href="/api/xero/connect" className="btn">
              Connect Xero
            </a>
          </>
        )}
        {configured && conn && (
          <>
            <p>
              Connected to <strong>{conn.tenantName}</strong>
              <span className="muted small"> · tokens refreshed {dateFmt(conn.updatedAt)}</span>
            </p>
            <p className="muted small">
              {linkedClients} client(s) and {linkedInvoices} invoice(s) linked to Xero.
            </p>
            <p className="muted small">
              You don&apos;t need to bulk-import — search Xero directly from{" "}
              <Link href="/clients/new">New client</Link> or <Link href="/projects/new">New project</Link>.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/clients/xero-import" className="btn btn-secondary">
                Bulk import all contacts
              </Link>
              <a href="/api/xero/connect" className="btn btn-secondary">
                Reconnect
              </a>
              <form action={disconnectXero}>
                <button type="submit" className="btn btn-danger">
                  Disconnect
                </button>
              </form>
            </div>
            <p className="muted small mt">
              Note: the Xero refresh token expires after 60 days without use. If syncs start failing,
              reconnect here.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Services / price list</h2>
        <p className="muted small">
          {serviceCount} active service(s). Used as line items when raising Xero invoices.
        </p>
        <Link href="/settings/services" className="btn btn-secondary">
          Manage services
        </Link>
      </div>

      <div className="card">
        <h2>MCP</h2>
        <p className="muted small">
          Endpoint: <code>/api/mcp</code> · Auth: <code>Authorization: Bearer &lt;MCP_API_KEY&gt;</code>
        </p>
      </div>
    </>
  );
}
