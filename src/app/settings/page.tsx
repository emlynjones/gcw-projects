import Link from "next/link";
import { getConnection, xeroConfigured, scopeIsCurrent } from "@/lib/xero";
import { disconnectXero } from "@/app/xero-actions";
import { updateAiSettings, clearAiKey } from "@/app/ai-actions";
import { importBackupAction } from "@/app/settings/backup-actions";
import {
  syncXeroInvoiceLinesAction,
  syncProgress,
  abandonInvoiceScan,
} from "@/app/xero-sync-actions";
import { getAiStatus, DEFAULT_AI_MODEL } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    xeroConnected?: string;
    xeroError?: string;
    importOk?: string;
    importError?: string;
    created?: string;
    updated?: string;
    skipped?: string;
    warnings?: string;
    synced?: string;
    clients?: string;
    invoices?: string;
    lines?: string;
    domains?: string;
    remaining?: string;
    syncErrors?: string;
  }>;
}) {
  const {
    xeroConnected,
    xeroError,
    importOk,
    importError,
    created,
    updated,
    skipped,
    warnings,
    synced,
    clients: syncedClients,
    invoices: syncedInvoices,
    lines: syncedLines,
    domains: syncedDomains,
    remaining,
    syncErrors,
  } = await searchParams;
  const conn = await getConnection();
  const configured = xeroConfigured();
  const linkedClients = await prisma.client.count({ where: { xeroContactId: { not: null } } });
  const linkedInvoices = await prisma.invoice.count({ where: { xeroInvoiceId: { not: null } } });
  const serviceCount = await prisma.service.count({ where: { active: true } });
  const ai = await getAiStatus();

  const scopeOk = scopeIsCurrent(conn?.scope);
  const lineCount = await prisma.xeroInvoiceLine.count();
  const lastSync = await prisma.setting.findUnique({ where: { key: "xeroLinesSyncedAt" } });
  const progress = conn ? await syncProgress() : { done: 0, total: 0, inProgress: false };

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {xeroConnected && <div className="success-msg">Xero connected.</div>}
      {xeroError === "state" && <div className="error-msg">Xero connection failed (state mismatch) — try again.</div>}
      {xeroError === "token" && <div className="error-msg">Xero connection failed at token exchange — check client ID/secret and redirect URI.</div>}
      {xeroError === "notconfigured" && <div className="error-msg">Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in the environment first.</div>}
      {importOk && (
        <div className="success-msg">
          Backup imported: {created} created, {updated} updated, {skipped} skipped.
          {warnings && <div className="small mt">{warnings}</div>}
        </div>
      )}
      {importError === "nofile" && <div className="error-msg">Choose a backup file first.</div>}
      {importError === "badjson" && <div className="error-msg">That file isn&apos;t valid JSON.</div>}
      {synced && (
        <div className="success-msg">
          Scanned {syncedClients} client(s): {syncedInvoices} invoice(s), {syncedLines} line(s),{" "}
          {syncedDomains} domain(s) found.
          {Number(remaining) > 0 ? (
            <> {remaining} client(s) still to scan — run the next batch below.</>
          ) : (
            <> Invoice history is up to date.</>
          )}
          {syncErrors && <div className="small mt">Errors: {syncErrors}</div>}
        </div>
      )}

      <div className="card">
        <h2>Backup &amp; restore</h2>
        <p className="muted small">
          Backs up clients, projects, invoices, notes, attachments and the service price list.
          Doesn&apos;t include login accounts, the Xero connection, AI settings, or uploaded files
          (proposals/briefs) — back those up separately.
        </p>
        <a href="/api/backup/export" className="btn">
          Download backup
        </a>

        <p className="muted small mt">
          Restore from a backup file. Matches existing records by ID and updates them; anything new is
          created. Existing data with matching IDs will be overwritten.
        </p>
        <form action={importBackupAction} className="row" style={{ alignItems: "center" }}>
          <input type="file" name="backupFile" accept="application/json,.json" required />
          <button type="submit" className="btn btn-secondary">
            Import backup
          </button>
        </form>
      </div>

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
            {!scopeOk && (
              <div className="error-msg">
                <strong>Reconnect needed.</strong> This connection was granted an old set of
                permissions that can&apos;t read your Xero products and has no write access. Click{" "}
                <strong>Reconnect</strong> below to grant the current ones — nothing else changes, and
                your existing links are kept.
              </div>
            )}
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

      {configured && conn && (
        <div className="card">
          <h2>Xero products</h2>
          <p className="muted small">
            Map your services to Xero&apos;s product list so invoice lines land in the right account
            instead of all going to the default sales code. The list is pulled in{" "}
            <strong>one API call</strong> and cached, so the mapping itself is done offline.
          </p>
          <Link href="/settings/xero-items" className="btn">
            Map services to products
          </Link>
        </div>
      )}

      {configured && conn && (
        <div className="card">
          <h2>Xero invoice history</h2>
          <p className="muted small">
            <strong>You almost certainly don&apos;t need this.</strong> The CSV import has already
            loaded the full ledger, and this scan fetches one client at a time, reaches back only
            three years, and would take hundreds of API calls to end up with less. It&apos;s worth
            running for a single client whose invoices changed in Xero since the import — the
            website page has a per-client button for exactly that.
          </p>
          <p className="muted small">
            {lineCount > 0 ? (
              <>
                <strong>{lineCount}</strong> invoice line(s) cached
                {lastSync && <> · last full scan {dateFmt(new Date(lastSync.value))}</>}
              </>
            ) : (
              <>Not scanned yet.</>
            )}
            {progress.inProgress && (
              <>
                {" · "}
                <span className="paid-no">
                  scan in progress: {progress.done} of {progress.total} clients
                </span>
              </>
            )}
          </p>
          {!scopeOk && (
            <p className="muted small">Reconnect Xero above before scanning.</p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={syncXeroInvoiceLinesAction}>
              <button type="submit" className="btn" disabled={!scopeOk}>
                {progress.inProgress ? "Scan next batch" : "Scan invoice history"}
              </button>
            </form>
            {progress.inProgress && (
              <form action={abandonInvoiceScan}>
                <button type="submit" className="btn btn-secondary">
                  Abandon this scan
                </button>
              </form>
            )}
            {lineCount > 0 && (
              <Link href="/recurring/billed" className="btn btn-secondary">
                View billed domains
              </Link>
            )}
          </div>
          <p className="muted small mt">
            Runs in batches of 12 clients (a few seconds each) to stay inside Xero&apos;s rate limit —
            press again until it reports it&apos;s up to date.
          </p>
        </div>
      )}

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
        <h2>AI</h2>
        <p className="muted small">
          Add an OpenAI or Claude API key to enable AI features (e.g. drafting a site structure from a
          brief). The key is stored encrypted and never shown again.
        </p>
        {ai.configured ? (
          <p>
            <span className="badge badge-life-COMPLETE">Key set</span>{" "}
            <span className="muted small">
              Provider: {ai.provider === "openai" ? "OpenAI" : "Claude (Anthropic)"} · Model:{" "}
              <code>{ai.model}</code>
            </span>
          </p>
        ) : (
          <p className="muted small">No API key set — AI features are disabled.</p>
        )}
        <form action={updateAiSettings} className="stack" style={{ maxWidth: 520 }}>
          <div className="row">
            <div className="field">
              <label htmlFor="provider">Provider</label>
              <select id="provider" name="provider" defaultValue={ai.provider ?? "anthropic"}>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                name="model"
                defaultValue={ai.model ?? DEFAULT_AI_MODEL.anthropic}
                placeholder="claude-sonnet-5 / gpt-4o"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="apiKey">API key {ai.configured && "(leave blank to keep current)"}</label>
            <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder="sk-… / sk-ant-…" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn">
              Save AI settings
            </button>
          </div>
        </form>
        {ai.configured && (
          <form action={clearAiKey} className="mt">
            <button type="submit" className="btn btn-danger btn-sm">
              Remove API key
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>MCP</h2>
        <p className="muted small">
          Endpoint: <code>/api/mcp</code> · Auth: <code>Authorization: Bearer &lt;MCP_API_KEY&gt;</code> (Claude
          Code), or OAuth (claude.ai connector — add the endpoint URL and approve at{" "}
          <code>/oauth/authorize</code>).
        </p>
      </div>
    </>
  );
}
