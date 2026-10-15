import { serviceKindLabel } from "@/lib/recurring";
import type { RenewalMonth } from "@/lib/recurring-dashboard";

const money = (n: number) =>
  n >= 1000 ? `£${(n / 1000).toFixed(1)}k` : `£${Math.round(n)}`;

/**
 * Renewals per month for the year ahead.
 *
 * Server-rendered: it's a static picture of stored data, so there's nothing for
 * JavaScript to do.
 */
export default function RenewalCalendar({ months }: { months: RenewalMonth[] }) {
  const total = months.reduce((n, m) => n + m.count, 0);

  if (!total) {
    return <p className="muted">No renewals fall in the next 12 months.</p>;
  }

  return (
    <table className="mt">
      <thead><tr><th style={{ width: 180 }}>Month</th><th>Services, in renewal-date order</th></tr></thead>
      <tbody>{months.map((m) => {
        const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(m.month);
        return (
          <tr key={m.month.toISOString()}>
            <td>
              <strong>{label}</strong>
              <div className="muted small">{m.count} renewal{m.count === 1 ? "" : "s"} · {money(m.value)}</div>
            </td>
            <td>
              {m.items.length === 0 ? <span className="muted small">Nothing due</span> : m.items.map((item) => (
                <div key={item.serviceId} style={{ marginBottom: 5 }}>
                  <strong>{new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(item.renewal)}</strong>{" "}
                  <span className="badge badge-type">{serviceKindLabel(item.kind)}</span>{" "}
                  {item.label} <span className="muted small">· <a href={`/websites/${item.websiteId}`}>{item.websiteName}</a>{item.clientName ? ` · ${item.clientName}` : ""}{item.value !== null ? ` · ${money(item.value)}` : ""}</span>
                </div>
              ))}
            </td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
