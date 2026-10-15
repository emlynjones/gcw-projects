import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  ADVANCE_BILLING_DAYS,
  currentPeriod,
  daysUntilRenewal,
  nextBillablePeriod,
  nextRenewal,
  periodLabel,
} from "@/lib/recurring";
import { assignServiceToWebsite } from "@/app/recurring-actions";

export const dynamic = "force-dynamic";

const dateFmt = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);

type State = "NOT_BILLABLE" | "REVIEW" | "OVERDUE" | "DUE" | "INVOICED" | "EXTERNAL" | "MISSED" | "NO_DATE" | "CANCELLED";

const stateLabel: Record<State, string> = {
  NOT_BILLABLE: "Ours — not invoiced",
  REVIEW: "Review invoice links",
  OVERDUE: "Overdue to invoice",
  DUE: "Due soon",
  INVOICED: "Invoiced",
  EXTERNAL: "Billed elsewhere",
  MISSED: "Missed / written off",
  NO_DATE: "No renewal date",
  CANCELLED: "Not renewing",
};

export default async function Microsoft365Page() {
  const [services, websites] = await Promise.all([
    prisma.recurringService.findMany({
      where: { kind: "O365" },
      include: {
        client: { select: { id: true, name: true, isInternal: true } },
        website: { select: { id: true, name: true } },
        billings: { orderBy: { periodStart: "desc" } },
        _count: { select: { invoiceLines: true } },
      },
      orderBy: [{ renewalDate: "asc" }, { label: "asc" }],
    }),
    prisma.website.findMany({
      select: { id: true, name: true, client: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const today = new Date();
  const rows = services.map((service) => {
    const renewal = nextRenewal(service, today);
    const period = currentPeriod(service, today);
    const billing = period
      ? service.billings.find((item) => item.periodStart <= period.end && item.periodEnd >= period.start)
      : null;
    const billable = nextBillablePeriod(service, service.billings, today);
    let state: State;
    if (service.client?.isInternal) state = "NOT_BILLABLE";
    else if (!service.active || service.cancelledAt) state = "CANCELLED";
    else if (!renewal || !period) state = "NO_DATE";
    else if (billing?.matchedBy === "EXTERNAL") state = "EXTERNAL";
    else if (billing?.matchedBy === "MISSED") state = "MISSED";
    else if (!billing && service._count.invoiceLines === 0) state = "REVIEW";
    else if (!billing) state = "OVERDUE";
    else if (billable?.advance) state = "DUE";
    else if (daysUntilRenewal(service, today)! <= ADVANCE_BILLING_DAYS) state = "DUE";
    else state = "INVOICED";

    return { service, renewal, period, billing, state };
  });

  const internal = rows.filter((row) => row.service.client?.isInternal);
  const customerRows = rows.filter((row) => !row.service.client?.isInternal);
  const loose = customerRows.filter((row) => !row.service.websiteId);
  const linked = customerRows.filter((row) => row.service.websiteId);
  const operational = customerRows.filter((row) => row.service.active && !row.service.cancelledAt);
  const overdue = operational.filter((row) => row.state === "OVERDUE").length;
  const review = operational.filter((row) => row.state === "REVIEW").length;
  const due = operational.filter((row) => row.state === "DUE").length;
  const seats = operational.reduce((sum, row) => sum + row.service.quantity, 0);

  const monthStarts = Array.from({ length: 12 }, (_, offset) =>
    new Date(today.getFullYear(), today.getMonth() + offset, 1)
  );

  return (
    <>
      <div className="page-head">
        <h1>Microsoft 365 subscriptions</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/invoices/run" className="btn">Billing run</Link>
          <Link href="/recurring" className="btn btn-secondary">All services</Link>
          <Link href="/recurring/dashboard" className="btn btn-secondary">Recurring overview</Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Review invoice links</div>
          <div className="value">{review}</div>
          <div className="muted small">no linked invoice-item history yet</div>
        </div>
        <div className="stat">
          <div className="label">Subscriptions</div>
          <div className="value">{operational.length}</div>
          <div className="muted small">{seats} licence{seats === 1 ? "" : "s"} / seats</div>
        </div>
        <div className="stat">
          <div className="label">Overdue to invoice</div>
          <div className="value">{overdue}</div>
          <div className="muted small">current term has no coverage</div>
        </div>
        <div className="stat">
          <div className="label">Due within {ADVANCE_BILLING_DAYS} days</div>
          <div className="value">{due}</div>
          <div className="muted small">ready to bill ahead</div>
        </div>
        <div className="stat">
          <div className="label">Not linked to a website</div>
          <div className="value">{loose.length}</div>
          <div className="muted small">needs attention below</div>
        </div>
      </div>

      {loose.length > 0 && (
        <div className="card o365-unlinked">
          <h2>Subscriptions not linked to a website</h2>
          <p className="muted small">
            Choose the website each subscription belongs to. If that website has a client, the
            subscription will be aligned to the same client automatically.
          </p>
          <table>
            <thead><tr><th>Subscription</th><th>Current client</th><th>Website</th><th /></tr></thead>
            <tbody>
              {loose.map(({ service }) => (
                <tr key={service.id}>
                  <td>{service.label}{service.quantity > 1 && <span className="muted"> ×{service.quantity}</span>}</td>
                  <td>{service.client?.name ?? <span className="paid-no">Unassigned</span>}</td>
                  <td colSpan={2}>
                    <form action={assignServiceToWebsite.bind(null, service.id)} className="inline-form">
                      <select name="websiteId" required defaultValue="">
                        <option value="" disabled>Choose website…</option>
                        {websites.map((website) => (
                          <option key={website.id} value={website.id}>
                            {website.name}{website.client ? ` · ${website.client.name}` : " · no client"}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-sm">Link</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Renewal timing — next 12 months</h2>
        <p className="muted small">Customer subscriptions only, listed by renewal date within each month.</p>
        <table>
          <thead><tr><th style={{ width: 180 }}>Month</th><th>Subscriptions, in renewal-date order</th></tr></thead>
          <tbody>
          {monthStarts.map((month) => {
            const inMonth = operational.filter(
              (row) => row.renewal && row.renewal.getFullYear() === month.getFullYear() && row.renewal.getMonth() === month.getMonth()
            ).sort((a, b) => a.renewal!.getTime() - b.renewal!.getTime());
            return (
              <tr key={month.toISOString()}>
                <td><strong>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month)}</strong><div className="muted small">{inMonth.length} subscription{inMonth.length === 1 ? "" : "s"}</div></td>
                <td>
                {inMonth.length ? inMonth.map((row) => (
                  <div className={`o365-calendar-item state-${row.state.toLowerCase()}`} key={row.service.id}>
                    {row.service.website ? <Link href={`/websites/${row.service.website.id}`}>{row.service.website.name}</Link> : <strong>{row.service.label}</strong>}
                    <span>{row.renewal && dateFmt(row.renewal)} · {row.service.label} · {row.service.client?.name ?? "No client"} · {stateLabel[row.state]}</span>
                  </div>
                )) : <span className="muted small">—</span>}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>

      {internal.length > 0 && (
        <div className="card">
          <h2>Our Microsoft 365 subscriptions</h2>
          <p className="muted small">Shown for oversight only. These are excluded from renewal work, billing warnings and invoices because their client is marked as us.</p>
          <table>
            <thead><tr><th>Website / subscription</th><th className="num">Seats</th><th>Next renewal</th><th>Status</th></tr></thead>
            <tbody>{internal.map(({ service, renewal }) => (
              <tr key={service.id}>
                <td>{service.website ? <Link href={`/websites/${service.website.id}`}>{service.website.name}</Link> : service.label}<div className="muted small">{service.label}</div></td>
                <td className="num">{service.quantity}</td>
                <td>{renewal ? dateFmt(renewal) : "—"}</td>
                <td><span className="badge">ours · not invoiced</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>All Microsoft 365 subscriptions</h2>
        {linked.length === 0 ? <p className="muted">No linked Microsoft 365 subscriptions yet.</p> : (
          <table>
            <thead><tr><th>Website / subscription</th><th>Client</th><th className="num">Seats</th><th>Next renewal</th><th>Current cover</th><th>Status</th></tr></thead>
            <tbody>
              {linked.map(({ service, renewal, period, state }) => (
                <tr key={service.id} style={service.active ? undefined : { opacity: 0.55 }}>
                  <td><Link href={`/websites/${service.website!.id}`}>{service.website!.name}</Link><div className="muted small">{service.label}</div></td>
                  <td>{service.client ? <Link href={`/clients/${service.client.id}`}>{service.client.name}</Link> : "—"}</td>
                  <td className="num">{service.quantity}</td>
                  <td>{renewal ? dateFmt(renewal) : <span className="paid-no">No date</span>}</td>
                  <td className="muted small">{period ? periodLabel(period) : "—"}</td>
                  <td><span className={`badge o365-state state-${state.toLowerCase()}`}>{stateLabel[state]}</span>{!service.active && <div className="muted small">inactive</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
