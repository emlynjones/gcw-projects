import {
  SERVICE_KINDS,
  serviceKindLabel,
  COST_BASES,
  COST_BASIS_LABELS,
  MANAGED_BY,
  MANAGED_BY_LABELS,
} from "@/lib/recurring";
import { updateRecurringService, setServiceCancelled } from "@/app/recurring-actions";

export type EditableService = {
  id: string;
  websiteId: string | null;
  kind: string;
  label: string;
  provider: string | null;
  managedBy?: string | null;
  externalRef: string | null;
  quantity: number;
  costPrice: number;
  costBasis: string;
  sellPrice: number;
  renewalDate: Date | null;
  termMonths: number;
  active: boolean;
  cancelledAt?: Date | string | null;
  notes: string | null;
  catalogueServiceId?: string | null;
};

export type WebsiteOption = { id: string; name: string };
export type CatalogueOption = { id: string; name: string; price: number; unit: string };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Inline edit form for a recurring service. Shared by the client panel and the
 * website page so a service is edited the same way wherever you find it.
 */
export default function ServiceEditor({
  service,
  websites,
  catalogue = [],
}: {
  service: EditableService;
  websites: WebsiteOption[];
  catalogue?: CatalogueOption[];
}) {
  return (
    <form action={updateRecurringService.bind(null, service.id)} className="stack mt">
      <div className="row">
        <div className="field">
          <label>Catalogue product</label>
          <select name="catalogueServiceId" defaultValue={service.catalogueServiceId ?? ""}>
            <option value="">— custom recurring service —</option>
            {catalogue.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · £{item.price.toFixed(2)}/{item.unit}
              </option>
            ))}
          </select>
          <span className="muted small">Leave Sell blank to use its catalogue price.</span>
        </div>
        <div className="field">
          <label>Type</label>
          <select name="kind" defaultValue={service.kind}>
            {SERVICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {serviceKindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Label</label>
          <input name="label" defaultValue={service.label} required />
        </div>
        <div className="field">
          <label>Website</label>
          <select name="websiteId" defaultValue={service.websiteId ?? ""}>
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
          <label>Provider</label>
          <input name="provider" defaultValue={service.provider ?? ""} placeholder="123 Reg" />
        </div>
        <div className="field">
          <label>Managed by</label>
          <select name="managedBy" defaultValue={service.managedBy ?? "GCW"}>
            {MANAGED_BY.map((m) => (
              <option key={m} value={m}>
                {MANAGED_BY_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Provider ref</label>
          <input name="externalRef" defaultValue={service.externalRef ?? ""} />
        </div>
        <div className="field">
          <label>Qty / seats</label>
          <input name="quantity" type="number" step="any" defaultValue={service.quantity} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Cost (ex-VAT)</label>
          <input name="costPrice" type="number" step="any" defaultValue={service.costPrice} />
        </div>
        <div className="field">
          <label>Cost is</label>
          <select name="costBasis" defaultValue={service.costBasis}>
            {COST_BASES.map((b) => (
              <option key={b} value={b}>
                {COST_BASIS_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Sell (ex-VAT)</label>
          <input name="sellPrice" type="number" step="any" defaultValue={service.sellPrice || ""} placeholder="Catalogue default" />
        </div>
        <div className="field">
          <label>Renews</label>
          <input name="renewalDate" type="date" defaultValue={isoDate(service.renewalDate)} />
        </div>
        <div className="field">
          <label>Term (months)</label>
          <input name="termMonths" type="number" min="1" step="1" defaultValue={service.termMonths} />
          <span className="muted small">Use 24 for a two-year domain. Prices are for the full term.</span>
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <input name="notes" defaultValue={service.notes ?? ""} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-sm">
          Save
        </button>
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            name="active"
            defaultChecked={service.active}
            style={{ width: "auto" }}
          />
          Active
        </label>
        <CancelControl id={service.id} cancelledAt={service.cancelledAt ?? null} />
      </div>
    </form>
  );
}

/**
 * Stop this renewing, or resume it.
 *
 * Its own form, submitted separately from the edit above — a form can't nest,
 * and cancelling isn't a field you save, it's a decision with its own moment.
 * Sits next to Active on purpose so the difference is visible: Active hides the
 * row, Cancel keeps it and stops the next renewal.
 */
function CancelControl({ id, cancelledAt }: { id: string; cancelledAt: Date | string | null }) {
  if (cancelledAt) {
    const when = new Date(cancelledAt);
    return (
      <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="badge badge-stage">Not renewing</span>
        cancelled {when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          formAction={setServiceCancelled.bind(null, id, false)}
        >
          Resume
        </button>
      </span>
    );
  }
  return (
    <button
      type="submit"
      className="btn btn-ghost btn-sm"
      formAction={setServiceCancelled.bind(null, id, true)}
      title="Keep it running to the end of the current term, then stop. Any unbilled year stays billable."
    >
      Cancel renewal
    </button>
  );
}
