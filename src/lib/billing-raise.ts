/**
 * Raising a draft invoice for recurring services, and recording what it covered.
 *
 * Shared by the per-website screen and the cross-client billing run so the two
 * can't drift. Everything money-shaped lives here: which price applies, what the
 * line says, which Xero product it books to, and the billing record written
 * afterwards.
 *
 * Deliberately not a server action — it's called from actions in both places,
 * which own the redirects and revalidation.
 */

import { prisma } from "@/lib/prisma";
import { createDraftInvoice, type InvoiceLine, type XeroInvoice } from "@/lib/xero";
import { recurringDescription } from "@/lib/invoice-descriptions";
import {
  nextBillablePeriod,
  trustedUnitPrice,
  serviceKindLabel,
  isBillable,
  annualCost,
  renewalDrift,
  RENEWAL_DRIFT_TOLERANCE_DAYS,
  addMonths,
} from "@/lib/recurring";

/** A service as the billing screens need to see it. */
export type BillableLine = {
  id: string;
  kind: string;
  kindLabel: string;
  label: string;
  quantity: number;
  /** Per-period unit price actually in force, from wherever it came. */
  unitPrice: number | null;
  priceSource: "service" | "product" | null;
  lineTotal: number;
  /** Annual cost to us, for the below-cost warning. */
  annualCost: number;
  belowCost: boolean;
  /**
   * The price is so far above cost that it's almost certainly bad data rather
   * than a real charge — see IMPLAUSIBLE_MARGIN.
   */
  priceLooksWrong: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  description: string;
  xeroItemCode: string | null;
  /** Nothing owing: covered, and the next renewal isn't due yet. */
  nothingOwing: boolean;
  /** No price from either source — can't be invoiced. */
  noPrice: boolean;
  advance: boolean;
  daysUntilStart: number;
  drift: { days: number; billedFrom: Date; suggested: Date } | null;
  websiteId: string | null;
  websiteName: string | null;
  clientId: string;
  clientName: string;
};

/** The shape every billing screen queries — kept in one place so they agree. */
export const BILLABLE_SELECT = {
  id: true,
  kind: true,
  label: true,
  quantity: true,
  costPrice: true,
  costBasis: true,
  sellPrice: true,
  renewalDate: true,
  termMonths: true,
  xeroItemCode: true,
  managedBy: true,
  cancelledAt: true,
  websiteId: true,
  clientId: true,
  billings: { select: { periodStart: true, periodEnd: true } },
} as const;

type ServiceRow = {
  id: string;
  kind: string;
  label: string;
  quantity: number;
  costPrice: number;
  costBasis: string;
  sellPrice: number;
  renewalDate: Date | null;
  termMonths: number;
  xeroItemCode: string | null;
  managedBy: string;
  cancelledAt: Date | null;
  websiteId: string | null;
  clientId: string | null;
  billings: { periodStart: Date; periodEnd: Date }[];
};

/**
 * A sell price this many times the cost is treated as suspect.
 *
 * Genuine margins here run to about six times — £60 hosting sold at £350 is
 * real. What isn't real is `placemaking-ceredigion.wales`: a £14.84 domain
 * carrying a £6,966.42 sell price, which is a whole website build that landed
 * in the wrong field during an early import. Offering that on a billing screen
 * would put a five-figure invoice for a domain renewal one click away, so
 * anything past this multiple is shown but can't be selected.
 */
export const IMPLAUSIBLE_MARGIN = 10;

/** Xero product prices, cached locally — see `effectiveSellPrice`. */
export async function itemPriceMap(): Promise<Map<string, number | null>> {
  const items = await prisma.xeroItem.findMany({ select: { code: true, unitPrice: true } });
  return new Map(items.map((i) => [i.code, i.unitPrice]));
}

/**
 * Turn services into billable lines.
 *
 * Services that aren't ours to bill are dropped outright rather than shown
 * greyed — a client's own domain isn't a billing decision anyone needs to make.
 */
export function toBillableLines(
  services: ServiceRow[],
  ctx: {
    itemPrices: Map<string, number | null>;
    clientNames: Map<string, string>;
    websiteNames: Map<string, string>;
    now?: Date;
  }
): BillableLine[] {
  const now = ctx.now ?? new Date();
  const out: BillableLine[] = [];

  for (const s of services) {
    if (!isBillable(s) || !s.clientId) continue;

    const billable = nextBillablePeriod(s, s.billings, now);
    const period = billable?.period ?? null;
    const cost = annualCost(s);

    const priced = trustedUnitPrice(s, ctx.itemPrices, cost);
    const unit = priced?.price ?? null;
    const lineTotal = unit ? Math.round(unit * (s.quantity || 1) * 100) / 100 : 0;

    const d = renewalDrift(s, s.billings);
    let drift: BillableLine["drift"] = null;
    if (d && d.days > RENEWAL_DRIFT_TOLERANCE_DAYS) {
      const term = s.termMonths || 12;
      let suggested = d.billedFrom;
      for (let i = 0; i < 200 && suggested <= now; i++) suggested = addMonths(suggested, term);
      drift = { days: d.days, billedFrom: d.billedFrom, suggested };
    }

    out.push({
      id: s.id,
      kind: s.kind,
      kindLabel: serviceKindLabel(s.kind),
      label: s.label,
      quantity: s.quantity,
      unitPrice: unit,
      priceSource: priced?.source ?? null,
      lineTotal,
      annualCost: cost,
      // Both checks need a real cost to compare against; a care plan is our own
      // time at £0 cost, where neither "below cost" nor a margin multiple means
      // anything.
      belowCost: !!unit && cost > 0 && lineTotal < cost,
      priceLooksWrong: !!unit && cost > 0 && lineTotal > cost * IMPLAUSIBLE_MARGIN,
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
      description: recurringDescription(s.kind, s.label, period, s.quantity),
      xeroItemCode: s.xeroItemCode,
      nothingOwing: !billable,
      noPrice: !unit,
      advance: billable?.advance ?? false,
      daysUntilStart: billable?.daysUntilStart ?? 0,
      drift,
      websiteId: s.websiteId,
      websiteName: s.websiteId ? (ctx.websiteNames.get(s.websiteId) ?? null) : null,
      clientId: s.clientId,
      clientName: ctx.clientNames.get(s.clientId) ?? "—",
    });
  }
  return out;
}

/**
 * Create one Xero draft for the given lines and record what it covered.
 *
 * The billing records are written in the same operation as the draft. We know
 * exactly what was billed here, so there's nothing for the matcher to infer
 * later, and the service leaves the not-yet-billed report the moment the draft
 * exists. Keyed on `(recurringServiceId, periodStart)` so raising the same
 * period twice updates rather than duplicating.
 */
export async function raiseInvoiceFor(
  client: {
    id: string;
    name: string;
    email: string | null;
    contactName: string | null;
    phone: string | null;
    xeroContactId: string | null;
    isInternal: boolean;
  },
  lines: BillableLine[],
  reference: string,
  ensureContact: (c: typeof client) => Promise<string>
): Promise<{ invoice: XeroInvoice; billed: number }> {
  if (client.isInternal) {
    throw new Error(`${client.name} is marked as us and cannot be invoiced.`);
  }
  // A suspect price is refused here as well as hidden in the UI — this is the
  // last point before an invoice exists in Xero.
  const suspect = lines.find((l) => l.priceLooksWrong);
  if (suspect) {
    throw new Error(
      `${suspect.label} is priced at £${suspect.lineTotal.toFixed(2)} against a cost of £${suspect.annualCost.toFixed(2)} — check the sell price before invoicing it.`
    );
  }

  const sendable = lines.filter((l) => !l.noPrice && l.unitPrice);
  if (!sendable.length) throw new Error("Nothing with a price to invoice.");

  const invoiceLines: InvoiceLine[] = sendable.map((l) => ({
    description: l.description,
    quantity: l.quantity || 1,
    unitAmount: l.unitPrice!,
    itemCode: l.xeroItemCode,
  }));

  const contactId = await ensureContact(client);
  const invoice = await createDraftInvoice({ contactId, reference, lines: invoiceLines });

  const writes = sendable
    .filter((l) => l.periodStart && l.periodEnd)
    .map((l) =>
      prisma.serviceBilling.upsert({
        where: {
          recurringServiceId_periodStart: {
            recurringServiceId: l.id,
            periodStart: l.periodStart!,
          },
        },
        update: {
          periodEnd: l.periodEnd!,
          amount: l.lineTotal,
          xeroInvoiceId: invoice.InvoiceID,
          xeroNumber: invoice.InvoiceNumber ?? null,
          xeroStatus: invoice.Status,
          matchedBy: "MANUAL",
        },
        create: {
          recurringServiceId: l.id,
          periodStart: l.periodStart!,
          periodEnd: l.periodEnd!,
          amount: l.lineTotal,
          xeroInvoiceId: invoice.InvoiceID,
          xeroNumber: invoice.InvoiceNumber ?? null,
          xeroStatus: invoice.Status,
          matchedBy: "MANUAL",
        },
      })
    );
  if (writes.length) await prisma.$transaction(writes);

  return { invoice, billed: sendable.length };
}
