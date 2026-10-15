import { projectFeeDescription } from "@/lib/invoice-descriptions";

/**
 * Invoice maths shared by the server action that raises invoices and the UI
 * that previews them. Pure — no Prisma, no Xero — so the client bundle can
 * import it and show the same numbers the action will bill.
 *
 * The closing invoice for a full project has two parts:
 *   - the balance of the agreed fee left after earlier invoices (the deposit)
 *   - the additional services attached to the project since
 * `totalValue` covers the fee only, so services are added on top rather than
 * carved out of it.
 */

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitAmount: number;
  /** Xero product code, so the line lands in the right account and report. */
  itemCode?: string | null;
};

export type ServiceInput = {
  name: string;
  unit: string;
  price: number;
  quantity: number;
  xeroItemCode?: string | null;
};

/**
 * Project fee lines bill as "Website design and development".
 *
 * The deposit, any interim, and the closing balance are all instalments of one
 * design-and-build fee, so they belong under one product rather than landing on
 * the default sales account untagged. Attached services carry their own codes.
 */
export const PROJECT_FEE_ITEM_CODE = "WDD";

/**
 * Ad-hoc work bills as general or technical website work, hourly or by the day.
 *
 * Which of the four it is only becomes clear once the job is done, so it's
 * picked when the invoice is raised rather than stored on the project. General
 * hourly is much the commonest, so it's the default and the rest are a choice
 * rather than a question. All four sit on account 008 in Xero.
 */
export const ADHOC_ITEM_CODES = [
  { code: "GWW", label: "General website work (hourly)" },
  { code: "TWW", label: "Technical website work (hourly)" },
  { code: "GWW-DAY", label: "General website work (day rate)" },
  { code: "TWW-DAY", label: "Technical website work (day rate)" },
] as const;

export const ADHOC_ITEM_CODE_DEFAULT = "GWW";

/** The picked ad-hoc code, falling back to general hourly for anything unrecognised. */
export const adhocItemCode = (choice?: string | null): string =>
  ADHOC_ITEM_CODES.some((c) => c.code === choice) ? (choice as string) : ADHOC_ITEM_CODE_DEFAULT;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const sumInvoiced = (invoices: { amount: number }[]) => round2(invoices.reduce((s, i) => s + i.amount, 0));

/** Unbilled part of the agreed fee. Clamped at zero — an over-invoiced project owes nothing more. */
export function feeRemainder(totalValue: number, invoices: { amount: number }[]) {
  return round2(Math.max(0, totalValue - sumInvoiced(invoices)));
}

/** Total of the additional services, ignoring zero-quantity rows (which never bill). */
export const servicesTotalOf = (services: ServiceInput[]) =>
  round2(services.filter((s) => s.quantity > 0).reduce((s, x) => s + x.price * x.quantity, 0));

/** One invoice line per additional service; a recurring unit is named in the description. */
export function serviceLines(services: ServiceInput[]): InvoiceLineInput[] {
  return services
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      description: s.unit && s.unit !== "one-off" ? `${s.name} (per ${s.unit})` : s.name,
      quantity: s.quantity,
      unitAmount: s.price,
      itemCode: s.xeroItemCode ?? null,
    }));
}

/**
 * Description for the balance line — only a follow-up invoice is a "balance".
 *
 * Worded to match the sales ledger, where project fees read "Website design and
 * development for {name} — …" rather than the bare project title.
 */
export const remainderDescription = (title: string, hasEarlierInvoices: boolean) =>
  projectFeeDescription(title, hasEarlierInvoices ? "BALANCE" : "FULL");
