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

export const XERO_SCOPES = "openid profile email offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read";

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
}

export async function getConnection() {
  return prisma.xeroConnection.findUnique({ where: { id: "xero" } });
}

export async function disconnect(): Promise<void> {
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

/** All customer contacts (paged). */
export async function getCustomers(): Promise<XeroContact[]> {
  const all: XeroContact[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api<{ Contacts: XeroContact[] }>(
      `/Contacts?where=IsCustomer%3D%3Dtrue&page=${page}&order=Name`
    );
    all.push(...(data.Contacts ?? []));
    if (!data.Contacts || data.Contacts.length < 100) break;
  }
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
  return data.Contacts[0];
}

export type InvoiceLine = { description: string; quantity: number; unitAmount: number };

/** Create a DRAFT ACCREC invoice — approve/send from Xero itself. */
export async function createDraftInvoice(input: {
  contactId: string;
  reference: string;
  lines: InvoiceLine[];
  dueInDays?: number;
}): Promise<XeroInvoice> {
  const accountCode = process.env.XERO_SALES_ACCOUNT_CODE || "200";
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + (input.dueInDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
  const body = {
    Invoices: [
      {
        Type: "ACCREC",
        Contact: { ContactID: input.contactId },
        Date: today,
        DueDate: due,
        Reference: input.reference,
        LineAmountTypes: "Exclusive",
        Status: "DRAFT",
        LineItems: input.lines.map((l) => ({
          Description: l.description,
          Quantity: l.quantity,
          UnitAmount: l.unitAmount,
          AccountCode: accountCode,
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
