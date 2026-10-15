import Link from "next/link";
import { gbp, dateFmt } from "@/lib/status";
import {
  SERVICE_KINDS,
  serviceKindLabel,
  billingStateOf,
  billingStateLabel,
  currentPeriod,
  periodLabel,
  daysUntilRenewal,
  nextRenewal,
  totals,
  annualSell,
  annualCost,
} from "@/lib/recurring";
import {
  createWebsite,
  updateWebsite,
  deleteWebsite,
  createRecurringService,
  deleteRecurringService,
} from "@/app/recurring-actions";
import ServiceEditor, { type CatalogueOption } from "@/app/components/ServiceEditor";

type Website = { id: string; name: string; url: string | null; notes: string | null };
type Billing = { periodStart: Date; periodEnd: Date };
type Service = {
  id: string;
  websiteId: string | null;
  kind: string;
  label: string;
  provider: string | null;
  externalRef: string | null;
  quantity: number;
  costPrice: number;
  costBasis: string;
  sellPrice: number;
  renewalDate: Date | null;
  termMonths: number;
  active: boolean;
  notes: string | null;
  managedBy: string;
  _count: { invoiceLines: number };
  billings: Billing[];
};

function ServiceRows({ services, websites, catalogue, clientInternal }: { services: Service[]; websites: Website[]; catalogue: CatalogueOption[]; clientInternal: boolean }) {
  return (
    <>
      {services.map((s) => {
        const state = billingStateOf({ ...s, clientInternal }, s.billings, new Date(), s._count.invoiceLines);
        const period = currentPeriod(s);
        const days = daysUntilRenewal(s);
        const next = nextRenewal(s);
        return (
          <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
            <td>
              <details>
                <summary>
                  {s.label}
                  {!s.active && <span className="badge ml-1">inactive</span>}
                </summary>
                <ServiceEditor service={s} websites={websites} catalogue={catalogue} />
              </details>
            </td>
            <td>
              <span className="badge badge-type">{serviceKindLabel(s.kind)}</span>
            </td>
            <td className="muted small">{s.provider ?? "—"}</td>
            <td className="muted small">
              {next ? (
                <>
                  {dateFmt(next)}
                  {days !== null && days <= 60 && (
                    <span className="badge ml-1">{days <= 0 ? "due" : `${days}d`}</span>
                  )}
                  {period && <div className="small">{periodLabel(period)}</div>}
                </>
              ) : (
                "—"
              )}
            </td>
            <td className="num">{s.quantity !== 1 ? s.quantity : ""}</td>
            <td className="num">{gbp(annualCost(s))}</td>
            <td className="num">{gbp(annualSell(s))}</td>
            <td>
              <span className={`badge ${state === "BILLED" || state === "NOT_BILLABLE" ? "badge-life-COMPLETE" : state === "REVIEW" ? "badge-review" : "badge-life-LOST"}`}>
                {billingStateLabel(state)}
              </span>
            </td>
            <td>
              <form action={deleteRecurringService.bind(null, s.id)}>
                <button type="submit" className="btn btn-ghost btn-sm" title="Delete">
                  ✕
                </button>
              </form>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ServicesTable({ services, websites, catalogue, clientInternal }: { services: Service[]; websites: Website[]; catalogue: CatalogueOption[]; clientInternal: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Type</th>
          <th>Provider</th>
          <th>Renews</th>
          <th className="num">Qty</th>
          <th className="num">Cost</th>
          <th className="num">Sell</th>
          <th>This period</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <ServiceRows services={services} websites={websites} catalogue={catalogue} clientInternal={clientInternal} />
      </tbody>
    </table>
  );
}

export default function RecurringServices({
  clientId,
  clientInternal,
  websites,
  services,
  catalogue,
}: {
  clientId: string;
  clientInternal: boolean;
  websites: Website[];
  services: Service[];
  catalogue: CatalogueOption[];
}) {
  const loose = services.filter((s) => !s.websiteId);
  const active = services.filter((s) => s.active);
  const financial = clientInternal ? [] : active;
  const { sell: totalSell, cost: totalCost } = totals(financial);
  const unbilled = active.filter(
    (s) => billingStateOf({ ...s, clientInternal }, s.billings, new Date(), s._count.invoiceLines) === "UNBILLED"
  );

  return (
    <div className="card">
      <h2>Websites &amp; recurring services</h2>
      {services.length > 0 && (
        <p className="muted small">
          {active.length} active · {gbp(totalSell)} billed annually · {gbp(totalCost)} cost ·{" "}
          <strong>{gbp(totalSell - totalCost)} margin</strong>
          {unbilled.length > 0 && (
            <>
              {" · "}
              <span className="paid-no">{unbilled.length} not billed this period</span>
            </>
          )}
        </p>
      )}

      {websites.map((w) => (
        <div key={w.id} className="mt">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Link href={`/websites/${w.id}`}>
              <strong>{w.name}</strong>
            </Link>
            {w.url && <span className="muted small">{w.url}</span>}
          </div>
          <details>
            <summary className="muted small">Edit website</summary>
            <form action={updateWebsite.bind(null, w.id)} className="stack mt">
              <div className="row">
                <div className="field">
                  <label>Name</label>
                  <input name="name" defaultValue={w.name} required />
                </div>
                <div className="field">
                  <label>URL</label>
                  <input name="url" defaultValue={w.url ?? ""} />
                </div>
                <div className="field">
                  <label>Notes</label>
                  <input name="notes" defaultValue={w.notes ?? ""} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="btn btn-sm">
                  Save website
                </button>
              </div>
            </form>
            <form action={deleteWebsite.bind(null, w.id)} className="mt">
              <button type="submit" className="btn btn-danger btn-sm">
                Delete website
              </button>
              <span className="muted small ml-1">Its services are kept, just ungrouped.</span>
            </form>
          </details>
          <ServicesTable services={services.filter((s) => s.websiteId === w.id)} websites={websites} catalogue={catalogue} clientInternal={clientInternal} />
        </div>
      ))}

      {loose.length > 0 && (
        <div className="mt">
          {websites.length > 0 && <h3 className="muted small">Not linked to a website</h3>}
          <ServicesTable services={loose} websites={websites} catalogue={catalogue} clientInternal={clientInternal} />
        </div>
      )}

      {services.length === 0 && websites.length === 0 && (
        <p className="muted">No websites or recurring services yet.</p>
      )}

      <details className="mt">
        <summary>Add a website</summary>
        <form action={createWebsite} className="stack mt">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="row">
            <div className="field">
              <label htmlFor="w-name">Name</label>
              <input id="w-name" name="name" placeholder="acme.co.uk" required />
            </div>
            <div className="field">
              <label htmlFor="w-url">URL</label>
              <input id="w-url" name="url" placeholder="https://acme.co.uk" />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-secondary btn-sm">
              Add website
            </button>
          </div>
        </form>
      </details>

      <details className="mt">
        <summary>Add a recurring service</summary>
        <form action={createRecurringService} className="stack mt">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="field">
            <label htmlFor="s-catalogue">Catalogue product</label>
            <select id="s-catalogue" name="catalogueServiceId" defaultValue="">
              <option value="">— custom recurring service —</option>
              {catalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · £{item.price.toFixed(2)}/{item.unit}
                </option>
              ))}
            </select>
            <span className="muted small">Selecting a product supplies its standard price and Xero item.</span>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="s-kind">Type</label>
              <select id="s-kind" name="kind" defaultValue="DOMAIN">
                {SERVICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {serviceKindLabel(k)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="s-label">Label</label>
              <input id="s-label" name="label" placeholder="acme.co.uk" required />
            </div>
            <div className="field">
              <label htmlFor="s-website">Website</label>
              <select id="s-website" name="websiteId" defaultValue="">
                <option value="">— none —</option>
                {websites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="s-provider">Provider</label>
              <input id="s-provider" name="provider" placeholder="123 Reg" />
            </div>
            <div className="field">
              <label htmlFor="s-qty">Qty / seats</label>
              <input id="s-qty" name="quantity" type="number" step="any" defaultValue={1} />
            </div>
            <div className="field">
              <label htmlFor="s-cost">Cost (ex-VAT)</label>
              <input id="s-cost" name="costPrice" type="number" step="any" defaultValue={0} />
            </div>
            <div className="field">
              <label htmlFor="s-sell">Sell (ex-VAT)</label>
              <input id="s-sell" name="sellPrice" type="number" step="any" placeholder="Catalogue default" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="s-renew">Renews</label>
              <input id="s-renew" name="renewalDate" type="date" />
            </div>
            <div className="field">
              <label htmlFor="s-term">Term (months)</label>
                <input id="s-term" name="termMonths" type="number" min="1" step="1" defaultValue={12} />
                <span className="muted small">Use 24 for a two-year domain.</span>
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-secondary btn-sm">
              Add service
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
