"use client";

import { useMemo, useState } from "react";
import { parseCsv, detectDelimiter, guessColumn, parseMoney, parseDate } from "@/lib/csv";
import { SERVICE_KINDS, serviceKindLabel, COST_BASES, COST_BASIS_LABELS } from "@/lib/recurring";
import { importRecurringServices } from "@/app/recurring-import-actions";

/** Target fields, with the header names suppliers commonly use for each. */
const FIELDS = [
  // Order matters: guessing is exclusive, so the required name field gets first
  // refusal on ambiguous headers like "Account".
  { key: "label", label: "Domain / service name", required: true,
    guesses: ["domain name", "domain", "service", "product", "name", "item", "account name", "account", "site", "hostname", "description"] },
  { key: "externalRef", label: "Provider reference", required: false,
    guesses: ["order id", "subscription id", "account id", "reference", "ref", "id"] },
  { key: "renewalDate", label: "Renewal / expiry date", required: false,
    // "created"/"start date" trail the list on purpose: for annual-term products
    // the renewal is the anniversary of the start, and nextRenewal() rolls a past
    // date forward. A real renewal column always wins on the exact-match pass.
    guesses: ["renewal date", "renews", "expiry date", "expires", "expiry", "next billing date", "end date", "valid until", "created", "start date"] },
  { key: "costPrice", label: "Cost to us (ex-VAT)", required: false,
    guesses: ["cost", "cost ex vat", "our cost", "wholesale", "purchase price", "net"] },
  { key: "sellPrice", label: "Sell price (ex-VAT)", required: false,
    guesses: ["sell", "sell price", "retail", "price", "rrp", "amount", "charge"] },
  { key: "quantity", label: "Quantity / seats", required: false,
    guesses: ["quantity", "qty", "seats", "licences", "licenses", "users", "units"] },
  // Office 365 exports identify the buyer, not the site. Kept separate from the
  // label so it can drive matching without polluting what the service is called.
  { key: "customer", label: "Customer / account name", required: false,
    guesses: ["customername", "customer name", "customer", "client name", "client", "organisation", "organization", "company"] },
  { key: "status", label: "Status (Active / cancelled)", required: false,
    guesses: ["status", "state", "active"] },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type Mapping = Record<FieldKey, number>;

const PREVIEW_ROWS = 8;

export default function ImportForm() {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [kind, setKind] = useState<string>("DOMAIN");
  const [provider, setProvider] = useState("");
  const [termMonths, setTermMonths] = useState(12);
  const [costBasis, setCostBasis] = useState<string>("ANNUAL");
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      // Spreadsheet exports are often tab-separated; parsing those as CSV
      // silently yields one giant column rather than an error.
      const { headers: h, rows: r } = parseCsv(text, detectDelimiter(text));
      if (!h.length) {
        setError("That file has no header row.");
        return;
      }
      if (!r.length) {
        setError("That file has headers but no data rows.");
        return;
      }
      setHeaders(h);
      setRows(r);
      // Auto-guess the mapping, claiming columns in field order so no two
      // fields fight over the same header.
      const guessed = {} as Mapping;
      const taken = new Set<number>();
      for (const f of FIELDS) {
        const idx = guessColumn(h, [...f.guesses], taken);
        guessed[f.key] = idx;
        if (idx >= 0) taken.add(idx);
      }
      setMapping(guessed);
      // A filename often names the provider.
      if (!provider) {
        const lower = file.name.toLowerCase();
        if (lower.includes("123")) setProvider("123 Reg");
        else if (lower.includes("cloud")) setProvider("Cloud.Market");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  const mapped = useMemo(() => {
    if (!mapping) return [];
    const cell = (row: string[], key: FieldKey) => {
      const idx = mapping[key];
      return idx >= 0 ? (row[idx] ?? "") : "";
    };
    return rows.map((row) => ({
      label: cell(row, "label").trim(),
      externalRef: cell(row, "externalRef").trim() || null,
      renewalDate: parseDate(cell(row, "renewalDate"))?.toISOString() ?? null,
      renewalRaw: cell(row, "renewalDate"),
      costPrice: parseMoney(cell(row, "costPrice")),
      sellPrice: parseMoney(cell(row, "sellPrice")),
      quantity: parseMoney(cell(row, "quantity")),
      customer: cell(row, "customer").trim() || null,
      statusRaw: cell(row, "status").trim(),
    }));
  }, [rows, mapping]);

  const valid = mapped.filter((r) => r.label);
  const skipped = mapped.length - valid.length;
  const badDates = mapped.filter((r) => r.renewalRaw && !r.renewalDate).length;
  const labelMapped = mapping ? mapping.label >= 0 : false;

  const payload = JSON.stringify({
    kind,
    provider: provider.trim() || null,
    termMonths,
    costBasis,
    rows: valid.map(({ renewalRaw: _raw, statusRaw, ...r }) => ({
      ...r,
      // Anything that isn't plainly a live subscription comes in switched off,
      // so a cancelled licence never shows up as billable.
      active: statusRaw ? /^(active|live|enabled|yes|1|true)$/i.test(statusRaw) : null,
    })),
  });

  return (
    <>
      <div className="card">
        <h2>1. Choose a file</h2>
        <p className="muted small">
          A CSV export from 123 Reg, Cloud.Market or your hosting provider. If you have an{" "}
          <code>.xlsx</code>, open it and &ldquo;Save As&rdquo; CSV first.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {fileName && (
          <p className="muted small mt">
            {fileName} — {rows.length} data row(s), {headers.length} column(s)
          </p>
        )}
        {error && <div className="error-msg mt">{error}</div>}
      </div>

      {mapping && (
        <>
          <div className="card">
            <h2>2. What&apos;s in this file?</h2>
            <div className="row">
              <div className="field">
                <label htmlFor="kind">These are all…</label>
                <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {SERVICE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {serviceKindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="provider">Provider</label>
                <input
                  id="provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="123 Reg"
                />
              </div>
              <div className="field">
                <label htmlFor="term">Term (months)</label>
                <input
                  id="term"
                  type="number"
                  value={termMonths}
                  onChange={(e) => setTermMonths(Number(e.target.value) || 12)}
                />
              </div>
              <div className="field">
                <label htmlFor="basis">The cost column is…</label>
                <select id="basis" value={costBasis} onChange={(e) => setCostBasis(e.target.value)}>
                  {COST_BASES.map((b) => (
                    <option key={b} value={b}>
                      {COST_BASIS_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {costBasis === "MONTHLY" && (
              <p className="muted small">
                Costs will be stored as monthly and counted as &times;12 in annual totals. If the file
                mixes monthly and annual rows, import the bulk of them here and correct the odd one
                out on its service afterwards.
              </p>
            )}
          </div>

          <div className="card">
            <h2>3. Match the columns</h2>
            <p className="muted small">
              Guessed from your headers — change anything that&apos;s wrong. Only the name is required.
            </p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`map-${f.key}`}>
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <select
                    id={`map-${f.key}`}
                    value={mapping[f.key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [f.key]: Number(e.target.value) })
                    }
                  >
                    <option value={-1}>— not in file —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>4. Check and import</h2>
            {!labelMapped && (
              <div className="error-msg">
                Pick which column holds the domain / service name before importing.
              </div>
            )}
            <p className="muted small">
              {valid.length} row(s) ready
              {skipped > 0 && ` · ${skipped} skipped (no name)`}
              {badDates > 0 && ` · ${badDates} date(s) not understood — those import without a renewal date`}
            </p>

            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Renews</th>
                  <th className="num">Qty</th>
                  <th className="num">Cost</th>
                  <th className="num">Sell</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {valid.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={i}>
                    <td>{r.label}</td>
                    <td className="muted small">
                      {r.renewalDate ? (
                        new Date(r.renewalDate).toLocaleDateString("en-GB")
                      ) : r.renewalRaw ? (
                        <span className="paid-no">{r.renewalRaw} ?</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{r.quantity ?? 1}</td>
                    <td className="num">{r.costPrice ?? 0}</td>
                    <td className="num">{r.sellPrice ?? "—"}</td>
                    <td className="muted small">{r.externalRef ?? "—"}</td>
                  </tr>
                ))}
                {valid.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Nothing to import with the current mapping.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {valid.length > PREVIEW_ROWS && (
              <p className="muted small mt">…and {valid.length - PREVIEW_ROWS} more.</p>
            )}

            <form action={importRecurringServices} className="mt">
              <input type="hidden" name="payload" value={payload} />
              <button type="submit" className="btn" disabled={!labelMapped || valid.length === 0}>
                Import {valid.length} service(s)
              </button>
              <p className="muted small mt">
                Existing services are matched on provider reference (or name) and updated — importing
                the same file twice won&apos;t duplicate anything. Clients are matched from your Xero
                billing history where possible; anything uncertain lands in the Unassigned queue for
                you to confirm.
              </p>
            </form>
          </div>
        </>
      )}
    </>
  );
}
