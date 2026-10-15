"use client";

import { useId, useState } from "react";
import { gbp } from "@/lib/status";
import { servicesTotalOf, type ServiceInput } from "@/lib/invoicing";

type KindOption = { value: string; label: string };

/**
 * Preview and raise the closing invoice for a full project: the balance of the
 * agreed fee plus the additional services, either part switchable off. The
 * total shown here is computed from the same helpers the server action bills
 * from, so the button always names the amount that will land in Xero.
 */
export default function FinalInvoicePanel({
  action,
  services,
  remainder,
  totalValue,
  invoiced,
  defaultReference,
  kindOptions,
  defaultKind = "FINAL",
}: {
  action: (formData: FormData) => Promise<void>;
  services: ServiceInput[];
  remainder: number;
  totalValue: number;
  invoiced: number;
  defaultReference: string;
  kindOptions?: KindOption[];
  defaultKind?: string;
}) {
  // The panel renders twice on a project page (services card + Add invoice
  // modal), so ids have to be per-instance or the labels cross-wire.
  const uid = useId();
  const billable = services.filter((s) => s.quantity > 0);
  const servicesTotal = servicesTotalOf(services);

  const [withRemainder, setWithRemainder] = useState(remainder > 0);
  const [withServices, setWithServices] = useState(billable.length > 0);
  const [busy, setBusy] = useState(false);

  const total =
    (withRemainder ? remainder : 0) + (withServices ? servicesTotal : 0);
  const nothingToBill = remainder <= 0 && billable.length === 0;

  if (nothingToBill) {
    return (
      <p className="muted small">
        Nothing left to invoice — the {gbp(totalValue)} fee is fully invoiced and there are no
        additional services attached.
      </p>
    );
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        try {
          await action(fd);
        } finally {
          setBusy(false);
        }
      }}
      className="stack"
    >
      <table>
        <tbody>
          <tr>
            <td style={{ width: 34 }}>
              <input
                id={`${uid}-remainder`}
                name="includeRemainder"
                type="checkbox"
                checked={withRemainder}
                disabled={remainder <= 0}
                onChange={(e) => setWithRemainder(e.target.checked)}
                style={{ width: "auto", height: 20 }}
              />
            </td>
            <td>
              <label htmlFor={`${uid}-remainder`}>
                {invoiced > 0 ? "Balance of project fee" : "Project fee"}
              </label>
              <div className="muted small">
                {invoiced > 0
                  ? `${gbp(totalValue)} total value less ${gbp(invoiced)} already invoiced`
                  : `${gbp(totalValue)} total value, nothing invoiced yet`}
              </div>
            </td>
            <td className="num">{gbp(remainder)}</td>
          </tr>
          <tr>
            <td>
              <input
                id={`${uid}-services`}
                name="includeServices"
                type="checkbox"
                checked={withServices}
                disabled={billable.length === 0}
                onChange={(e) => setWithServices(e.target.checked)}
                style={{ width: "auto", height: 20 }}
              />
            </td>
            <td>
              <label htmlFor={`${uid}-services`}>
                Additional services ({billable.length} {billable.length === 1 ? "line" : "lines"})
              </label>
              <div className="muted small">
                {billable.length === 0
                  ? "None attached"
                  : billable
                      .map((s) => `${s.name}${s.quantity !== 1 ? ` ×${s.quantity}` : ""}`)
                      .join(", ")}
              </div>
            </td>
            <td className="num">{gbp(servicesTotal)}</td>
          </tr>
          <tr>
            <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>
              Invoice total (ex-VAT)
            </td>
            <td className="num" style={{ fontWeight: 700 }}>
              {gbp(total)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="inline-form">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`${uid}-reference`}>Reference</label>
          <input id={`${uid}-reference`} name="reference" defaultValue={defaultReference} />
        </div>
        {kindOptions && kindOptions.length > 0 && (
          <div className="field">
            <label htmlFor={`${uid}-kind`}>Role</label>
            <select id={`${uid}-kind`} name="kind" defaultValue={defaultKind}>
              {kindOptions.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn" disabled={busy || total <= 0}>
          {busy ? "Creating…" : `Raise ${gbp(total)} invoice (DRAFT in Xero)`}
        </button>
      </div>
      <p className="muted small">
        Created as a draft — review, approve and send from Xero. A linked invoice row is added here
        automatically.
      </p>
    </form>
  );
}
