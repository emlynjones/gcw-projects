/**
 * Lean Xero client — OAuth2 (authorization code + refresh rotation) and the
 * few Accounting API endpoints we need. Deliberately no xero-node SDK:
 * we need 5 endpoints and full control over token persistence in Prisma.
 */
import { prisma } from "@/lib/prisma";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API = "https://api.xero.com/api.xro/2.0";

/**
 * Xero scopes. `accounting.invoices` and `accounting.contacts` are read+write
 * (Xero's granular model — no `.read` suffix means full access to that
 * resource); `accounting.settings.read` is required for the Items (products)
 * endpoint. NB: this app's Xero Developer Portal registration fixes its scope
 * set at creation time — it cannot be changed without recreating the app, so
 * this list must stay within what's already enabled there. In particular
 * there is no `accounting.transactions` scope for this app; Xero splits that
 * into `accounting.invoices` / `accounting.payments` / `accounting.banktransactions`
 * / `accounting.manualjournals` instead — requesting the wrong name fails the
 * whole authorize request with `invalid_scope`.
 *
 * NB: the previous value used `accounting.invoices.read` / `accounting.payments.read`,
 * which — despite the name — were read-only, so there was no write grant and no
 * access to Items. Changing this string is not enough on its own: existing
 * refresh tokens keep their original grant, so Xero must be reconnected from
 * Settings for the new scopes to take effect (see `scopeIsCurrent`).
 */
export const XERO_SCOPES =
  "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings.read";

/** Scopes we can't work without — used to prompt for a reconnect after the fix above. */
const REQUIRED_SCOPES = ["accounting.invoices", "accounting.contacts", "accounting.settings.read"];

/** Whether a stored connection was granted the scopes the app now needs. */
export function scopeIsCurrent(scope: string | null | undefined): boolean {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.every((s) => granted.has(s));
}

function creds() {
  const id = process.env.XERO_CLIENT_ID;
  const secret = process.env.XERO_CLIENT_SECRET;
  if (!id || !secret) throw new Error("XERO_CLIENT_ID / XERO_CLIENT_SECRET not configured");
  return { id, secret, basic: Buffer.from(`${id}:${secret}`).toString("base64") };
}

export function xeroConfigured(): boolean {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/xero/callback`;
}

export function authorizeUrl(state: string): string {
  const { id } = creds();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: redirectUri(),
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { basic } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Xero token request failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Exchange auth code, resolve tenant, persist the connection. */
export async function completeConnection(code: string): Promise<void> {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    })
  );

  const connRes = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!connRes.ok) throw new Error(`Xero connections lookup failed (${connRes.status})`);
  const tenants: { tenantId: string; tenantName: string }[] = await connRes.json();
  if (!tenants.length) throw new Error("No Xero organisation authorised");
  const tenant = tenants[0]; // one org — GCW's own books

  const data = {
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scope: token.scope ?? XERO_SCOPES,
  };
  await prisma.xeroConnection.upsert({ where: { id: "xero" }, update: data, create: { id: "xero", ...data } });
  clearContactsCache(); // a different org may have been authorised
}

export async function getConnection() {
  return prisma.xeroConnection.findUnique({ where: { id: "xero" } });
}

export async function disconnect(): Promise<void> {
  clearContactsCache();
  await prisma.xeroConnection.deleteMany({ where: { id: "xero" } });
}

/** Valid access token — refreshes (and persists the rotated refresh token) when <60s left. */
async function accessToken(): Promise<{ token: string; tenantId: string }> {
  const conn = await getConnection();
  if (!conn) throw new Error("Xero is not connected — connect it in Settings.");

  if (conn.expiresAt.getTime() - Date.now() > 60_000) {
    return { token: conn.accessToken, tenantId: conn.tenantId };
  }

  const token = await tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refreshToken })
  );
  await prisma.xeroConnection.update({
    where: { id: "xero" },
    data: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token, // rotation — must persist every time
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    },
  });
  return { token: token.access_token, tenantId: conn.tenantId };
}

/**
 * Xero allows 60 calls a minute per tenant. One brief retry smooths over a
 * burst; anything worse is reported plainly rather than as a raw 429, because
 * the fix is to wait rather than to reconnect — and a bare "429" reads like a
 * broken connection to whoever sees it.
 */
const RATE_LIMIT_RETRY_MS = 3_000;

async function api<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const { token, tenantId } = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 429) {
    // Xero says which ceiling was hit. They are very different problems: a
    // minute limit clears while you read the message, a day limit doesn't clear
    // until tomorrow — so never tell someone to "try again shortly" for one.
    const problem = (res.headers.get("x-rate-limit-problem") ?? "").toLowerCase();
    const retryAfter = Number(res.headers.get("Retry-After"));

    if (problem === "day") {
      const hours = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.round(retryAfter / 3600)
        : null;
      throw new Error(
        `Xero's daily API limit (5,000 calls) is used up${hours ? `; it resets in about ${hours} hours` : " until tomorrow"}. The connection is fine — Xero lookups will start working again on their own.`
      );
    }

    if (attempt === 0) {
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, RATE_LIMIT_RETRY_MS)
        : RATE_LIMIT_RETRY_MS;
      await new Promise((r) => setTimeout(r, wait));
      return api<T>(path, init, attempt + 1);
    }

    throw new Error(
      "Xero is rate limiting us (60 calls a minute). Nothing is broken — wait a minute and try again."
    );
  }

  if (!res.ok) throw new Error(`Xero API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/* ---------- Types (the fields we use) ---------- */

export type XeroContact = {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Phones?: { PhoneType: string; PhoneNumber?: string; PhoneAreaCode?: string }[];
  IsCustomer?: boolean;
};

export type XeroLineItem = {
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  LineAmount?: number;
  ItemCode?: string;
  AccountCode?: string;
};

export type XeroInvoice = {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  Type: string;
  Status: string; // DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED | DELETED
  SubTotal: number; // ex-VAT
  Total: number;
  AmountDue?: number;
  Date?: string; // MS JSON date: /Date(ms+0000)/
  Contact?: { ContactID: string; Name: string };
  LineItems?: XeroLineItem[];
};

/** A product in the Xero price list — used to bill recurring services properly. */
export type XeroItem = {
  ItemID: string;
  Code: string;
  Name?: string;
  Description?: string;
  IsSold?: boolean;
  // Xero keeps a separate sales description from the item's own; it's the one
  // that lands on an invoice line when you pick the item in their UI.
  SalesDetails?: { UnitPrice?: number; AccountCode?: string; Description?: string };
};

export function parseXeroDate(d?: string): Date | null {
  if (!d) return null;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? new Date(parseInt(m[1], 10)) : new Date(d);
}

export function contactPhone(c: XeroContact): string | null {
  const p = c.Phones?.find((ph) => ph.PhoneType === "DEFAULT" && ph.PhoneNumber);
  return p ? `${p.PhoneAreaCode ?? ""}${p.PhoneNumber}` : null;
}

/* ---------- Endpoints ---------- */

/**
 * All active contacts (paged). We deliberately do NOT filter on IsCustomer:
 * Xero only sets IsCustomer=true once a contact has a sales transaction, so a
 * brand-new contact would otherwise never appear in the picker. Fetching all
 * ACTIVE contacts shows newly-added clients immediately.
 */
/**
 * The contact list is memoised because fetching it is *several* paged calls and
 * it's needed by every page carrying a client picker. Without this, working
 * through the websites builder re-fetched the whole address book on each page
 * load and exhausted Xero's 60-calls-a-minute budget within a couple of minutes.
 *
 * Staleness is harmless: callers filter it against local clients on every call,
 * so a contact linked in the meantime still drops out of the "unlinked" list.
 * A contact newly created in Xero shows up within the window.
 */
const CONTACTS_TTL_MS = 10 * 60_000;
let contactsCache: { at: number; contacts: XeroContact[] } | null = null;

/** Drop the memo — after connecting, disconnecting, or creating a contact. */
export function clearContactsCache(): void {
  contactsCache = null;
}

export async function getCustomers(force = false): Promise<XeroContact[]> {
  if (!force && contactsCache && Date.now() - contactsCache.at < CONTACTS_TTL_MS) {
    return contactsCache.contacts;
  }

  const where = encodeURIComponent('ContactStatus=="ACTIVE"');
  const all: XeroContact[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await api<{ Contacts: XeroContact[] }>(
      `/Contacts?where=${where}&page=${page}&order=Name`
    );
    all.push(...(data.Contacts ?? []));
    if (!data.Contacts || data.Contacts.length < 100) break;
  }

  contactsCache = { at: Date.now(), contacts: all };
  return all;
}

export type XeroContactLite = {
  contactId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  /** Same email or name as an existing local client — picking it will link, not duplicate. */
  matchesExisting: boolean;
};

/** Xero customers not yet linked to a local client, for search/import pickers. */
export async function getUnlinkedXeroContacts(): Promise<XeroContactLite[]> {
  const [customers, clients] = await Promise.all([
    getCustomers(),
    prisma.client.findMany({ select: { name: true, email: true, xeroContactId: true } }),
  ]);
  const linkedIds = new Set(clients.map((c) => c.xeroContactId).filter(Boolean));
  const localEmails = new Set(clients.map((c) => c.email?.toLowerCase()).filter(Boolean));
  const localNames = new Set(clients.map((c) => c.name.toLowerCase()));

  return customers
    .filter((c) => !linkedIds.has(c.ContactID))
    .map((c) => ({
      contactId: c.ContactID,
      name: c.Name,
      contactName: [c.FirstName, c.LastName].filter(Boolean).join(" ") || null,
      email: c.EmailAddress || null,
      matchesExisting:
        (!!c.EmailAddress && localEmails.has(c.EmailAddress.toLowerCase())) ||
        localNames.has(c.Name.toLowerCase()),
    }));
}

/** ACCREC invoices for one contact, newest first. */
export async function getContactInvoices(contactId: string): Promise<XeroInvoice[]> {
  const data = await api<{ Invoices: XeroInvoice[] }>(
    `/Invoices?ContactIDs=${contactId}&where=Type%3D%3D%22ACCREC%22&order=Date%20DESC&page=1`
  );
  return (data.Invoices ?? []).filter((i) => i.Status !== "DELETED" && i.Status !== "VOIDED");
}

/** Fetch specific invoices by ID (for syncing linked ones). */
export async function getInvoicesByIds(ids: string[]): Promise<XeroInvoice[]> {
  if (!ids.length) return [];
  const data = await api<{ Invoices: XeroInvoice[] }>(`/Invoices?IDs=${ids.join(",")}`);
  return data.Invoices ?? [];
}

/**
 * One page of the sales ledger, summary-only — InvoiceID, number, contact,
 * date, status, and no line items.
 *
 * This is what makes a CSV import worth doing. An export carries every line of
 * every invoice but no InvoiceID and no ContactID, so it can't link back to
 * Xero and can't identify a client except by name. One pass of this endpoint
 * supplies both for the entire ledger at 100 invoices a call — a few dozen
 * calls, against the several hundred a full per-client history sync would cost.
 *
 * Returns [] past the last page, which is how the caller knows to stop.
 */
export async function getInvoiceIndexPage(page: number): Promise<XeroInvoice[]> {
  const where = encodeURIComponent('Type=="ACCREC"');
  const data = await api<{ Invoices: XeroInvoice[] }>(
    `/Invoices?where=${where}&order=Date&page=${page}&summaryOnly=true`
  );
  return data.Invoices ?? [];
}

/**
 * All ACCREC invoices for a contact since `since`, across pages, **including
 * line items** — the line descriptions are what we scan for domain names.
 *
 * Xero's list endpoint omits LineItems on some plans/versions; where that
 * happens we re-fetch the invoices individually (the single-invoice endpoint
 * always returns them). Each page is 100 invoices; we cap at 10 pages.
 */
export async function getContactInvoicesSince(
  contactId: string,
  since: Date
): Promise<XeroInvoice[]> {
  const where = encodeURIComponent(
    `Type=="ACCREC" AND Date>=DateTime(${since.getFullYear()},${since.getMonth() + 1},${since.getDate()})`
  );
  const all: XeroInvoice[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api<{ Invoices: XeroInvoice[] }>(
      `/Invoices?ContactIDs=${contactId}&where=${where}&order=Date%20DESC&page=${page}`
    );
    const batch = data.Invoices ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  const live = all.filter((i) => i.Status !== "DELETED" && i.Status !== "VOIDED");

  // Backfill line items for any invoice the list endpoint returned without them.
  const missing = live.filter((i) => !i.LineItems?.length).map((i) => i.InvoiceID);
  if (missing.length) {
    const byId = new Map<string, XeroInvoice>();
    for (let i = 0; i < missing.length; i += 40) {
      const chunk = missing.slice(i, i + 40);
      for (const full of await getInvoicesByIds(chunk)) byId.set(full.InvoiceID, full);
    }
    return live.map((i) => (i.LineItems?.length ? i : (byId.get(i.InvoiceID) ?? i)));
  }
  return live;
}

/** The Xero product/price list. Requires the accounting.settings.read scope. */
export async function getItems(): Promise<XeroItem[]> {
  const data = await api<{ Items: XeroItem[] }>(`/Items`);
  return data.Items ?? [];
}

/** Create a contact in Xero (used when invoicing an unlinked client). */
export async function createContact(input: {
  name: string;
  email?: string | null;
  contactName?: string | null;
  phone?: string | null;
}): Promise<XeroContact> {
  const [firstName, ...rest] = (input.contactName ?? "").split(" ").filter(Boolean);
  const body = {
    Contacts: [
      {
        Name: input.name,
        ...(input.email ? { EmailAddress: input.email } : {}),
        ...(firstName ? { FirstName: firstName, LastName: rest.join(" ") || undefined } : {}),
        ...(input.phone ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: input.phone }] } : {}),
      },
    ],
  };
  const data = await api<{ Contacts: XeroContact[] }>(`/Contacts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  clearContactsCache(); // the memoised list no longer has everything
  return data.Contacts[0];
}

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  /** Xero product code — set for recurring services mapped to a Xero item. */
  itemCode?: string | null;
};

/** Create a DRAFT ACCREC invoice — approve/send from Xero itself. */
export async function createDraftInvoice(input: {
  contactId: string;
  reference: string;
  lines: InvoiceLine[];
  dueInDays?: number;
  /** Explicit invoice date — defaults to today. */
  date?: Date;
  /** Explicit due date — overrides dueInDays. */
  dueDate?: Date;
}): Promise<XeroInvoice> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const invoiceDate = input.date ?? new Date();
  const due = input.dueDate ?? new Date(invoiceDate.getTime() + (input.dueInDays ?? 30) * 86_400_000);
  const body = {
    Invoices: [
      {
        Type: "ACCREC",
        Contact: { ContactID: input.contactId },
        Date: iso(invoiceDate),
        DueDate: iso(due),
        Reference: input.reference,
        LineAmountTypes: "Exclusive",
        Status: "DRAFT",
        // Description and UnitAmount are always sent, including alongside an
        // ItemCode. Picking a product in Xero's own UI overwrites both with the
        // product's defaults — which is how "Hosting for x.co.uk, 04/04/25 to
        // 04/04/26" becomes a bare "Hosting Service". The API keeps what it's
        // given, so setting the code here means never having to set it there.
        //
        // AccountCode is never sent. Passing one explicitly overrides the
        // product's own sales account, and the products are already set up with
        // the right ones (hosting to 004, licences to 011, ad-hoc work to 008).
        // Defaulting untagged lines to 200 was no better: it was corrected by
        // hand in the draft every time, so the app was only ever guessing wrong
        // more slowly. Left off, Xero applies the item's account or the org
        // default and the draft opens on the right one.
        LineItems: input.lines.map((l) => ({
          Description: l.description,
          Quantity: l.quantity,
          UnitAmount: l.unitAmount,
          ...(l.itemCode ? { ItemCode: l.itemCode } : {}),
        })),
      },
    ],
  };
  const data = await api<{ Invoices: XeroInvoice[] }>(`/Invoices`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.Invoices[0];
}
