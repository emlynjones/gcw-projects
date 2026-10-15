"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { combineExports, isSalesInvoiceExport, type CombineSummary } from "@/lib/xero-csv";
import { importInvoiceCsvs } from "@/app/invoice-import-actions";

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d) : "—";

type Preview = { summary: CombineSummary; rejected: string[] };

/**
 * Two-step import: read the files in the browser and show what they add up to,
 * then commit.
 *
 * The preview isn't decoration. A set of date-windowed exports is easy to get
 * wrong — a missing window leaves a hole in the history that nothing downstream
 * would flag, and the duplicate count is the only visible sign the windows
 * actually overlap. Both are worth seeing before writing thousands of rows.
 */
export default function ImportForm() {
  const router = useRouter();
  const [texts, setTexts] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    setError(null);
    setDone(null);
    setPreview(null);
    setTexts([]);
    if (!files?.length) return;

    setBusy(true);
    try {
      const read = await Promise.all([...files].map((f) => f.text()));
      const rejected: string[] = [];
      const good: string[] = [];
      [...files].forEach((f, i) => {
        if (isSalesInvoiceExport(read[i])) good.push(read[i]);
        else rejected.push(f.name);
      });

      if (!good.length) {
        setError(
          "None of those look like a Xero Sales Invoices export. Export from Xero with Business → Invoices → Export, which produces one row per invoice line."
        );
        return;
      }
      const { summary } = combineExports(good);
      setTexts(good);
      setPreview({ summary, rejected });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const r = await importInvoiceCsvs(texts);
      setDone(
        `${r.created} lines added, ${r.updated} refreshed. ` +
          (r.unindexed
            ? `${r.unindexed} lines across ${r.distinctUnindexedInvoices} invoices aren't in the Xero index yet — they'll link up after the next index sync. `
            : "") +
          (r.unresolvedClient
            ? `${r.unresolvedClient} lines belong to Xero contacts that aren't clients here, so they can't be matched yet.`
            : "")
      );
      setPreview(null);
      setTexts([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const s = preview?.summary;

  return (
    <div className="stack">
      <div className="card">
        <h2>1. Choose the exports</h2>
        <p className="muted small">
          Xero limits each export to a date range, so a full history is several files. Select them
          all at once — overlapping windows are expected and the duplicates are removed here.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          disabled={busy}
        />
      </div>

      {error && <div className="error-msg">{error}</div>}
      {done && <div className="success-msg">{done}</div>}

      {s && (
        <div className="card">
          <h2>2. Check, then import</h2>

          {!!preview.rejected.length && (
            <div className="error-msg">
              Skipped {preview.rejected.length} file(s) that aren&apos;t sales-invoice exports:{" "}
              {preview.rejected.join(", ")}
            </div>
          )}

          <table className="table">
            <tbody>
              <tr>
                <th>Files read</th>
                <td>{s.files}</td>
              </tr>
              <tr>
                <th>Invoice lines to import</th>
                <td>
                  <strong>{s.lines.toLocaleString()}</strong> across {s.invoices.toLocaleString()}{" "}
                  invoices
                </td>
              </tr>
              <tr>
                <th>Period covered</th>
                <td>
                  {fmtDate(s.firstDate)} – {fmtDate(s.lastDate)}
                </td>
              </tr>
              <tr>
                <th>Duplicate rows removed</th>
                <td className="muted">
                  {s.duplicates.toLocaleString()}{" "}
                  <span className="small">— expected, where the export windows overlap</span>
                </td>
              </tr>
              <tr>
                <th>Credit notes &amp; overpayments skipped</th>
                <td className="muted">
                  {s.skippedType.toLocaleString()}{" "}
                  <span className="small">— not charges, so they aren&apos;t billing evidence</span>
                </td>
              </tr>
              {s.dateInferred > 0 && (
                <tr>
                  <th>Undated invoices</th>
                  <td className="muted">
                    {s.dateInferred} kept, dated from their due date{" "}
                    <span className="small">— worth dating properly in Xero</span>
                  </td>
                </tr>
              )}
              {s.skippedUnusable > 0 && (
                <tr>
                  <th>Blank lines skipped</th>
                  <td className="muted">{s.skippedUnusable}</td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="muted small">
            Importing again later is safe — lines are keyed on their invoice and position, so
            re-running refreshes them rather than duplicating, and any link you&apos;ve confirmed
            stays put.
          </p>

          <button className="btn" onClick={commit} disabled={busy}>
            {busy ? "Importing…" : `Import ${s.lines.toLocaleString()} lines`}
          </button>
        </div>
      )}
    </div>
  );
}
