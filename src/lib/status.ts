export const STATUSES = [
  "ENQUIRY",
  "PROPOSAL_SENT",
  "ACTIVE",
  "INVOICED",
  "PAID",
  "COMPLETE",
  "ARCHIVED",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  ENQUIRY: "Enquiry",
  PROPOSAL_SENT: "Proposal Sent",
  ACTIVE: "Active",
  INVOICED: "Invoiced",
  PAID: "Paid",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};

export function statusLabel(s: string): string {
  return STATUS_LABELS[s as Status] ?? s;
}

export function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

/* ---------- Project types ---------- */

export const PROJECT_TYPES = ["WEBSITE", "ADHOC"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  WEBSITE: "Website project",
  ADHOC: "Ad-hoc project",
};

export function projectTypeLabel(t: string): string {
  return PROJECT_TYPE_LABELS[t as ProjectType] ?? t;
}

export function isProjectType(t: string): t is ProjectType {
  return (PROJECT_TYPES as readonly string[]).includes(t);
}

/* ---------- Invoice roles ---------- */

export const INVOICE_KINDS = ["DEPOSIT", "INTERIM", "FINAL"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  DEPOSIT: "Deposit",
  INTERIM: "Interim",
  FINAL: "Final",
};

export function invoiceKindLabel(k: string | null | undefined): string | null {
  if (!k) return null;
  return INVOICE_KIND_LABELS[k as InvoiceKind] ?? k;
}

export function isInvoiceKind(k: string): k is InvoiceKind {
  return (INVOICE_KINDS as readonly string[]).includes(k);
}

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

export const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
