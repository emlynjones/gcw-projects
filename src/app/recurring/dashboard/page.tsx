import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serviceKindLabel } from "@/lib/recurring";
import { itemPriceMap } from "@/lib/billing-raise";
import { buildRecurringDashboard, type SiteGroup } from "@/lib/recurring-dashboard";
import RenewalCalendar from "./RenewalCalendar";

export const dynamic = "force-dynamic";

const money = (n: number) => `£${n.toFixed(2)}`;
const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

/**
 * What the recurring book needs doing to it.
 *
 * Overdue first — a renewal already paid for and not passed on is money gone,
 * and it stays gone until someone acts. Then what's coming, so it can be billed
 * before the supplier takes payment. The calendar underneath answers a
 * different question: not what to do now, but when the year gets busy.
 *
 * Every row leads to the website, because that's where both fixes are: link an
 * invoice that already exists to the period, or raise a new one.
 */
export default async function RecurringDashboardPage() {
  const [websites, itemPrices] = await Promise.all([
    prisma.website.findMany({
      where: { clientId: { not: null } },
      select: {
        id: true,
        name: true,
        clientId: true,
        client: { select: { name: true, isInternal: true } },
        services: {
          where: { active: true },
          select: {
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
            billings: {
              select: {
                periodStart: true,
                periodEnd: true,
                amount: true,
                xeroInvoiceId: true,
                xeroNumber: true,
                xeroStatus: true,
                matchedBy: true,
              },
            },
            _count: { select: { invoiceLines: true } },
          },
        },
      },
    }),
    itemPriceMap(),
  ]);

  const dash = buildRecurringDashboard(
    websites.map((w) => ({
      id: w.id,
      name: w.name,
      clientId: w.clientId,
      clientName: w.client?.name ?? null,
      clientInternal: w.client?.isInternal ?? false,
      services: w.services,
    })),
    itemPrices
  );

  return (
    <>
      <div className="page-head">
        <h1>Recurring</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/invoices/run" className="btn">
            Billing run
          </Link>
          <Link href="/invoices/link-scan" className="btn btn-secondary">
            Suggested links
          </Link>
          <Link href="/recurring" className="btn btn-secondary">
            All services
          </Link>
          <Link href="/recurring/careplans" className="btn btn-secondary">
            Care plans
          </Link>
          <Link href="/recurring/microsoft-365" className="btn btn-secondary">
            Microsoft 365
          </Link>
          <Link href="/websites" className="btn btn-secondary">
            Websites
          </Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Review invoice links</div>
          <div className="value">{dash.reviewCount}</div>
          <div className="muted small">
            periods without any linked invoice-item history
          </div>
        </div>
        <div className="stat">
          <div className="label">Overdue to invoice</div>
          <div className="value">{money(dash.overdueValue)}</div>
          <div className="muted small">
            {dash.overdueCount} period(s) across {dash.overdue.length} site(s)
          </div>
        </div>
        <div className="stat">
          <div className="label">Renewing within 60 days</div>
          <div className="value">{money(dash.upcomingValue)}</div>
          <div className="muted small">
            {dash.upcomingCount} renewal(s) across {dash.upcoming.length} site(s)
          </div>
        </div>
        <div className="stat">
          <div className="label">Next 12 months</div>
          <div className="value">
            {dash.months.reduce((n, m) => n + m.count, 0)}
          </div>
          <div className="muted small">
            renewals worth {money(dash.months.reduce((n, m) => n + m.value, 0))}
          </div>
        </div>
      </div>

      <SiteList
        title="Review or link invoice items first"
        blurb="These services have no linked invoice items, so we cannot yet say they were not billed. Check for an existing Xero invoice and link it before treating the period as missing."
        groups={dash.review}
        empty="Every service has invoice-item evidence to support its billing status."
        tone="review"
      />

      <SiteList
        title="Not billed"
        blurb="These services do have linked invoice history, but no invoice covers the current period."
        groups={dash.overdue}
        empty="Nothing overdue. Every running term has an invoice against it."
        tone="bad"
      />

      <SiteList
        title="Renewing soon — bill ahead"
        blurb="These renew within 60 days. Invoicing now means the client has paid before the supplier takes payment."
        groups={dash.upcoming}
        empty="Nothing renews in the next 60 days."
        tone="warn"
      />

      {(dash.overdueUnpriced > 0 || dash.suspectPrices > 0) && (
        <p className="muted small">
          {dash.overdueUnpriced > 0 && (
            <>
              {dash.overdueUnpriced} overdue period(s) carry no usable price, so they can&apos;t be
              raised until one is set —{" "}
              <Link href="/reports/recurring">see what&apos;s missing a price</Link>.{" "}
            </>
          )}
          {dash.suspectPrices > 0 && (
            <>
              {dash.suspectPrices} service(s) are priced at more than ten times cost and are left
              out of these totals — almost certainly bad data rather than a real charge.
            </>
          )}
        </p>
      )}

      <div className="card">
        <h2>Renewals by month</h2>
        <p className="muted small">
          When the next renewal of each domain, hosting account and licence falls due — the shape of
          the year ahead, not a list of things to do now. Care plans are excluded; they bill monthly
          from Xero.
        </p>
        <RenewalCalendar months={dash.months} />
      </div>
    </>
  );
}

/** A section of website groups, each linking to the site that fixes it. */
function SiteList({
  title,
  blurb,
  groups,
  empty,
  tone,
}: {
  title: string;
  blurb: string;
  groups: SiteGroup[];
  empty: string;
  tone: "bad" | "warn" | "review";
}) {
  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {groups.length > 0 && (
          <span className={tone === "bad" ? "paid-no small" : tone === "review" ? "review-warning small" : "muted small"}>
            {groups.reduce((n, g) => n + g.items.length, 0)} period(s)
          </span>
        )}
      </div>
      <p className="muted small">{blurb}</p>

      {groups.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Website</th>
              <th>Client</th>
              <th>Periods</th>
              <th className="num">Value</th>
              <th style={{ width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.websiteId}-${tone}`}>
                <td>
                  <Link href={`/websites/${g.websiteId}`}>{g.websiteName}</Link>
                </td>
                <td className="muted small">
                  {g.clientId ? (
                    <Link href={`/clients/${g.clientId}`}>{g.clientName}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="small">
                  {g.items.map((i) => (
                    <div key={`${i.serviceId}-${i.periodStart.toISOString()}`}>
                      <span className="badge badge-match">{serviceKindLabel(i.kind)}</span>{" "}
                      {i.label}{" "}
                      <span className="muted">
                        {dateFmt(i.periodStart)} – {dateFmt(i.periodEnd)}
                      </span>{" "}
                      {tone === "bad" || tone === "review" ? (
                        <span className={tone === "review" ? "review-warning" : "paid-no"}>
                          {i.days > 0 ? `${i.days} days ago` : "just started"}
                          {i.state === "REVIEW" && " · invoice links need review"}
                        </span>
                      ) : (
                        <span className="muted">in {i.days} days</span>
                      )}
                    </div>
                  ))}
                </td>
                <td className="num">
                  {money(g.value)}
                  {g.unpriced > 0 && (
                    <div className="muted small">{g.unpriced} with no price</div>
                  )}
                </td>
                <td>
                  <Link href={`/websites/${g.websiteId}`} className="btn btn-sm">
                    Review site
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
