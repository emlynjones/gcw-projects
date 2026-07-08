# GCW Projects

Project pipeline tracker for Gwe Cambrian Web. Next.js 15 (App Router, TypeScript), SQLite + Prisma, Auth.js v5, MCP server built in.

**Pipeline:** Enquiry → Proposal Sent → Active → Invoiced → Paid → Complete → Archived
**Values:** all ex-VAT, GBP.

## Local dev

```bash
npm install
cp .env.example .env        # fill in values; DATABASE_URL=file:./dev.db is fine locally
npx prisma db push
npm run db:seed             # creates admin user from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

For local dev set `AUTH_URL=http://localhost:3000`. Admin credentials login works without any Azure setup.

## Azure AD (Entra ID) setup — staff SSO

1. [portal.azure.com](https://portal.azure.com) → Microsoft Entra ID → **App registrations** → **New registration**
2. Name: `GCW Projects`. Supported account types: **Accounts in this organizational directory only** (single tenant).
3. Redirect URI (Web): `https://projects.cambrianweb.dev/api/auth/callback/microsoft-entra-id`
   (add `http://localhost:3000/api/auth/callback/microsoft-entra-id` for dev)
4. Overview page → copy **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID_ID`
5. Copy **Directory (tenant) ID** → issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0` → `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
6. **Certificates & secrets** → New client secret → copy the **Value** (not the ID) → `AUTH_MICROSOFT_ENTRA_ID_SECRET`. Diary the expiry.
7. API permissions: default `User.Read` (delegated) is sufficient.

Staff who sign in via Microsoft are auto-created as `staff` users. `ALLOWED_EMAIL_DOMAIN=cambrianweb.com` blocks anything else.

## Deploy to Arianrhod

```bash
# 1. Copy the repo to the server
ssh emlynjones@84.92.67.199 -p 906
sudo mkdir -p /data-drive/docker/gcw-projects/data
# put the code in /data-drive/docker/gcw-projects/app (git clone or scp)

# 2. Configure
cd /data-drive/docker/gcw-projects/app
cp .env.example .env && nano .env    # real secrets: AUTH_SECRET, Entra creds, ADMIN_PASSWORD, MCP_API_KEY

# 3. Build + run (container port 3000 → host 3010)
docker compose up -d --build

# 4. Nginx + DNS
sudo cp deploy/projects.cambrianweb.dev.conf /etc/nginx/conf.d/
sudo nginx -t && sudo nginx -s reload
# DNS: projects.cambrianweb.dev → 84.92.67.199 (covered by the *.cambrianweb.dev wildcard cert)
```

SQLite lives in the `/data-drive/docker/gcw-projects/data` volume — include it in the normal backup routine.

**Port 3010** was chosen to avoid the in-use ports (7777 leantime, 5050 wiki, 4040 owncloud).

## MCP server

Endpoint: `https://projects.cambrianweb.dev/api/mcp` (streamable HTTP)
Auth: `Authorization: Bearer <MCP_API_KEY>`

Claude Code:

```bash
claude mcp add gcw-projects --transport http https://projects.cambrianweb.dev/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

Tools: `list_clients`, `create_client`, `update_client`, `delete_client`, `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `add_invoice`, `update_invoice`, `delete_invoice`, `add_note`, `delete_note`, `add_attachment`, `delete_attachment`, `list_services`, `dashboard_summary`.

## Xero integration

Setup: create a **Web app** at [developer.xero.com/app/manage](https://developer.xero.com/app/manage) with redirect URI `https://projects.cambrianweb.dev/api/xero/callback`, put the client ID/secret in `.env`, restart, then **Settings → Connect Xero**. Scopes: `offline_access accounting.contacts accounting.transactions`.

What it does:

- **Contact import** (Settings → Import contacts from Xero): pulls Xero customers; rows matching an existing client by email/name are linked (`xeroContactId`) instead of duplicated.
- **Link invoices**: on a project, "Link to Xero invoices" lists the client's unlinked ACCREC invoices; linking pulls amount (SubTotal, ex-VAT), number and status. "Sync from Xero" refreshes all linked invoices — `PAID` in Xero marks them paid here.
- **Raise invoice**: build line items from the Services price list (qty/price editable + custom lines) — creates a **DRAFT** ACCREC invoice in Xero (approve and send from Xero) and adds the linked row locally. If the client isn't in Xero, the contact is created automatically.
- Tokens: single app-wide connection stored in SQLite; refresh tokens rotate on every refresh and are persisted. Xero expires unused refresh tokens after 60 days — reconnect from Settings if syncs fail.

Services price list is seeded from the GCW catalogue on container start (`prisma/seed-services.js`, create-only — edits made in the UI are never overwritten). Manage at Settings → Services.

## Auth model

- **Microsoft Entra ID** — GCW staff SSO; users auto-provisioned as `staff`.
- **Credentials** — admin login, seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on container start (re-running updates the password).
- `admin` and `staff` have identical full-CRUD permissions in v1.

## v1 deferred (schema-ready, logic not built)

- Xero sync (`xeroContactId`, `xeroInvoiceId`, `xeroSynced` fields reserved)
- Client portal logins (add a `client` role later)
- File upload attachments (link-only for now — SharePoint URLs)
