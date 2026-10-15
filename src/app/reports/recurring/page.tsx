import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  currentPeriod,
  billingStateOf,
  annualCost,
  annualSell,
  totals,
  periodLabel,
  serviceKindLabel,
  isMonthlyKind,
  isBillable,
  effectiveSellPrice,
  nextBillablePeriod,
} from "@/lib/recurring";
import { itemPriceMap } from "@/lib/billing-raise";

export const dynamic = "force-dynamic";

const money = (n: number) => `£${n.toFixed(2)}`;
const monthFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(d));

type Row = {
  id: string;
  label: string;
  kind: string;
  cost: number;
  sell: number;
  period: string;
  hasPrice: boolean;
  websiteId: string | null;
};

/**
 * What has been renewed and never charged on.
 *
 * Two failures look alike on a spreadsheet and mean different things, so they
 * are counted apart here. A service with **no billing record** may be a genuine
 * leak — paid to the supplier, never invoiced — or simply a match nobody has
 * confirmed yet, which is why the review queue is linked wherever this number
 * appears. A service **billed below cost** is a different problem entirely: the
 * invoice went out, the price on it was just wrong.
 */
export default async function RecurringReportPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; view?: string }>;
}) {
  const { kind, view } = await searchParams;

  const clients = await prisma.client.findMany({
    where: { isInternal: false, recurringServices: { some: { active: true } } },
    select: {
      id: true,
      name: true,
      recurringServices: {
        where: { active: true, ...(kind ? { kind } : {}) },
        select: {
          id: true,
          label: true,
          kind: true,
          quantity: true,
          costPrice: true,
          costBasis: true,
          sellPrice: true,
          renewalDate: true,
          termMonths: true,
          websiteId: true,
          xeroItemCode: true,
          managedBy: true,
          billings: { select: { periodStart: true, periodEnd: true } },
          _count: { select: { invoiceLines: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const unreviewed = await prisma.xeroInvoiceLine.count({ where: { reviewed: false } });
  const itemPrices = await itemPriceMap();

  /** Renewals inside the advance window — what to bill before it falls due. */
  const dueSoon: {
    clientId: string;
    clientName: string;
    label: string;
    kind: string;
    days: number;
    amount: number;
    websiteId: string | null;
  }[] = [];

  /**
   * Services owing money that can't be invoiced because neither the service nor
   * its Xero product carries a price. The fix belongs in Xero, so this is a
   * worklist rather than something the app tries to fill in.
   */
  const missingPrice: {
    clientId: string;
    clientName: string;
    label: string;
    kind: string;
    cost: number;
    hasProduct: boolean;
    websiteId: string | null;
  }[] = [];

  const groups: { id: string; name: string; rows: Row[]; cost: number; sell: number }[] = [];
  let leakCost = 0;
  let leakCount = 0;
  let noPriceCount = 0;
  let underwaterCost = 0;
  let underwaterCount = 0;

  /**
   * Care plans are reported apart from renewals, and the reason is the question
   * each one answers. A domain is bought in and resold once a year, so what
   * matters is margin — cost against sell. A care plan is our own time billed
   * monthly at no bought-in cost, so margin is always "100%" and meaningless;
   * the only thing worth knowing is whether this month went out. Mixed into one
   * table the monthly rows would also swamp the annual ones twelve to one.
   */
  const carePlans: {
    clientId: string;
    clientName: string;
    label: string;
    monthly: number;
    monthsMissed: number;
    lastBilled: Date | null;
    websiteId: string | null;
  }[] = [];

  for (const client of clients) {
    const rows: Row[] = [];

    for (const s of client.recurringServices) {
      // A client's own domain, or one held by another agency, is tracked on its
      // website but isn't ours to bill — so it can't be unbilled revenue.
      if (!isBillable(s)) continue;

      const state = billingStateOf(s, s.billings, new Date(), s._count.invoiceLines);
      const cost = annualCost(s);
      const sell = annualSell(s);

      const owing = nextBillablePeriod(s, s.billings);
      const priced = effectiveSellPrice(s, itemPrices);
      if (owing?.advance && priced) {
        dueSoon.push({
          clientId: client.id,
          clientName: client.name,
          label: s.label,
          kind: serviceKindLabel(s.kind),
          days: owing.daysUntilStart,
          amount: Math.round(priced.price * (s.quantity || 1) * 100) / 100,
          websiteId: s.websiteId,
        });
      }
      if (owing && !priced) {
        missingPrice.push({
          clientId: client.id,
          clientName: client.name,
          label: s.label,
          kind: serviceKindLabel(s.kind),
          cost,
          hasProduct: !!s.xeroItemCode,
          websiteId: s.websiteId,
        });
      }

      if (isMonthlyKind(s.kind)) {
        if (state === "BILLED") continue;
        const lastBilled = s.billings.length
          ? new Date(Math.max(...s.billings.map((b) => b.periodEnd.getTime())))
          : null;
        // Months since cover ran out — what a missed care plan is actually worth.
        const monthsMissed = lastBilled
          ? Math.max(1, Math.floor((Date.now() - lastBilled.getTime()) / (30.44 * 86_400_000)))
          : 1;
        carePlans.push({
          clientId: client.id,
          clientName: client.name,
          label: s.label,
          monthly: s.sellPrice,
          monthsMissed,
          lastBilled,
          websiteId: s.websiteId,
        });
        continue;
      }

      if (state === "BILLED") {
        // Billed, but for less than it costs us — a pricing problem, not a gap.
        if (s.sellPrice > 0 && sell < cost) {
          underwaterCost += cost - sell;
          underwaterCount++;
        }
        continue;
      }

      const period = currentPeriod(s);
      rows.push({
        id: s.id,
        label: s.label,
        kind: s.kind,
        cost,
        sell,
        period: period ? periodLabel(period) : "no renewal date",
        hasPrice: s.sellPrice > 0,
        websiteId: s.websiteId,
      });

      leakCost += cost;
      leakCount++;
      if (s.sellPrice === 0) noPriceCount++;
    }

    if (!rows.length) continue;
    rows.sort((a, b) => b.cost - a.cost);
    groups.push({
      id: client.id,
      name: client.name,
      rows,
      cost: totals(rows.map((r) => ({ costPrice: r.cost, costBasis: "ANNUAL", sellPrice: r.sell, quantity: 1 }))).cost,
      sell: rows.reduce((n, r) => n + r.sell, 0),
    });
  }

  const shown = view === "noprice" ? groups.filter((g) => g.rows.some((r) => !r.hasPrice)) : groups;
  shown.sort((a, b) => b.cost - a.cost);

  dueSoon.sort((a, b) => a.days - b.days);
  missingPrice.sort((a, b) => b.cost - a.cost);
  carePlans.sort((a, b) => b.monthly * b.monthsMissed - a.monthly * a.monthsMissed);
  const carePlanMissed = carePlans.reduce((n, c) => n + c.monthly * c.monthsMissed, 0);
  const carePlanAnnual = carePlans.reduce((n, c) => n + c.monthly * 12, 0);

  const chip = (params: string, label: string, active: boolean) => (
    <Link href={`/reports/recurring${params}`} className={active ? "active" : ""}>
      {label}
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <h1>Not yet billed</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/invoices/run" className="btn">
            Billing run
          </Link>
          <Link href="/invoices/review" className="btn btn-secondary">
            Review queue
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="label">
              Not billed — {leakCount} service{leakCount === 1 ? "" : "s"}
            </div>
            <div className="value">{money(leakCost)}</div>
            <div className="muted">a year, paid out to suppliers</div>
          </div>
          <div className="stat">
            <div className="label">No sell price</div>
            <div className="value">{noPriceCount}</div>
            <div className="muted">of those, nothing to charge from</div>
          </div>
          {underwaterCount > 0 && (
            <div className="stat">
              <div className="label">
                Billed below cost — {underwaterCount} service{underwaterCount === 1 ? "" : "s"}
              </div>
              <div className="value">{money(underwaterCost)}</div>
              <div className="muted">a year, invoiced for less than it costs</div>
            </div>
          )}
        </div>

        {unreviewed > 0 && (
          <p className="muted small">
            {unreviewed.toLocaleString()} imported invoice lines haven&apos;t been reviewed yet, so
            some of these will have been billed after all —{" "}
            <Link href="/invoices/review">work through the queue</Link> before treating this as a
            list to invoice.
          </p>
        )}
      </div>

      <div className="filters">
        {chip("", "All kinds", !kind)}
        {chip("?kind=DOMAIN", "Domains", kind === "DOMAIN")}
        {chip("?kind=HOSTING", "Hosting", kind === "HOSTING")}
        {chip("?kind=O365", "Office 365", kind === "O365")}
        {chip("?kind=CAREPLAN", "Care plans", kind === "CAREPLAN")}
        {chip(
          view === "noprice" ? (kind ? `?kind=${kind}` : "") : `?view=noprice${kind ? `&kind=${kind}` : ""}`,
          "No sell price",
          view === "noprice"
        )}
      </div>

      {dueSoon.length > 0 && (
        <div className="card">
          <h2>Due within 60 days</h2>
          <p className="muted small">
            Renewals to invoice <em>before</em> they fall due, so the client has paid before you pay
            the supplier. Raise them together on the{" "}
            <Link href="/invoices/run">billing run</Link>.
          </p>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th className="num">Renews in</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {dueSoon.map((d) => (
                <tr key={`${d.clientId}-${d.label}`}>
                  <td>
                    <Link href={`/clients/${d.clientId}`}>{d.clientName}</Link>
                  </td>
                  <td>
                    <span className="badge badge-match">{d.kind}</span>{" "}
                    {d.websiteId ? (
                      <Link href={`/websites/${d.websiteId}`}>{d.label}</Link>
                    ) : (
                      d.label
                    )}
                  </td>
                  <td className="num">{d.days} days</td>
                  <td className="num">{money(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missingPrice.length > 0 && (
        <div className="card">
          <h2>Missing a price — {missingPrice.length} service(s)</h2>
          <p className="muted small">
            These owe money but can&apos;t be invoiced: neither the service nor the Xero product it
            maps to carries a price. Prices belong in Xero, so the fix is to set the product&apos;s
            price there and re-sync, or map the service to the right product in{" "}
            <Link href="/settings/xero-items">Xero products</Link>. Total cost being paid out:{" "}
            <strong>{money(missingPrice.reduce((n, m) => n + m.cost, 0))}</strong>/yr.
          </p>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th className="num">Costs us</th>
                <th>Xero product</th>
              </tr>
            </thead>
            <tbody>
              {missingPrice.slice(0, 60).map((m) => (
                <tr key={`${m.clientId}-${m.label}`}>
                  <td>
                    <Link href={`/clients/${m.clientId}`}>{m.clientName}</Link>
                  </td>
                  <td>
                    <span className="badge badge-match">{m.kind}</span>{" "}
                    {m.websiteId ? (
                      <Link href={`/websites/${m.websiteId}`}>{m.label}</Link>
                    ) : (
                      m.label
                    )}
                  </td>
                  <td className="num">{money(m.cost)}/yr</td>
                  <td className="small">
                    {m.hasProduct ? (
                      <span className="paid-no">mapped, but the product has no price</span>
                    ) : (
                      <span className="muted">not mapped to a product</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {missingPrice.length > 60 && (
            <p className="muted small">Showing the 60 costliest of {missingPrice.length}.</p>
          )}
        </div>
      )}

      {carePlans.length > 0 && (
        <div className="card">
          <h2>Care plans — not billed this month</h2>
          <div className="stats">
            <div className="stat">
              <div className="label">
                {carePlans.length} plan{carePlans.length === 1 ? "" : "s"} outstanding
              </div>
              <div className="value">{money(carePlanMissed)}</div>
              <div className="muted">not invoiced since cover ran out</div>
            </div>
            <div className="stat">
              <div className="label">Worth if all billed</div>
              <div className="value">{money(carePlanAnnual)}</div>
              <div className="muted">a year across these plans</div>
            </div>
          </div>
          <p className="muted small">
            Care plans bill monthly, so a gap is money already gone rather than a renewal coming up.
            Cost isn&apos;t shown because a care plan is your own time rather than something bought
            in — the only question is whether the month went out.
          </p>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Plan</th>
                <th className="num">Monthly</th>
                <th>Last covered</th>
                <th className="num">Months</th>
                <th className="num">Owed</th>
              </tr>
            </thead>
            <tbody>
              {carePlans.map((c) => (
                <tr key={`${c.clientId}-${c.label}`}>
                  <td>
                    <Link href={`/clients/${c.clientId}`}>{c.clientName}</Link>
                  </td>
                  <td>
                    {c.websiteId ? <Link href={`/websites/${c.websiteId}`}>{c.label}</Link> : c.label}
                  </td>
                  <td className="num">{money(c.monthly)}</td>
                  <td className="muted small">
                    {c.lastBilled ? monthFmt(c.lastBilled) : "never billed"}
                  </td>
                  <td className="num">{c.monthsMissed}</td>
                  <td className="num">{money(c.monthly * c.monthsMissed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!shown.length ? (
        <div className="card">
          <p>Nothing outstanding — every active service has a billing record for its current period.</p>
        </div>
      ) : (
        shown.map((g) => (
          <div className="card" key={g.id}>
            <div className="page-head" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/clients/${g.id}`}>{g.name}</Link>
              </h2>
              <span className="muted small">
                {money(g.cost)} cost · {money(g.sell)} charged
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Type</th>
                  <th>Current period</th>
                  <th className="num">Costs us</th>
                  <th className="num">Would charge</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.websiteId ? (
                        <Link href={`/websites/${r.websiteId}`}>{r.label}</Link>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="small">{serviceKindLabel(r.kind)}</td>
                    <td className="small muted">{r.period}</td>
                    <td className="num">{money(r.cost)}</td>
                    <td className="num">
                      {r.hasPrice ? (
                        money(r.sell)
                      ) : (
                        <span className="muted" title="No sell price set">
                          not priced
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </>
  );
}
