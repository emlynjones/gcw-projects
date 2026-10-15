"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncInvoiceIndex, adoptCsvLines } from "@/app/invoice-import-actions";

/**
 * Runs the index in bounded passes rather than one long request.
 *
 * A few thousand invoices is more calls than fits comfortably in a single
 * request, and a rate-limit halfway through shouldn't lose the ground already
 * covered — the cursor is server-side, so each press resumes where the last
 * left off.
 */
export default function IndexSync({ hasCursor }: { hasCursor: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(restart: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await syncInvoiceIndex(restart);
      if (r.error) {
        setError(r.error);
      } else {
        // Any lines imported before their invoice was indexed can now be given
        // their real ID, so the link appears without a re-import.
        const adopted = await adoptCsvLines();
        setMessage(
          `${r.invoices.toLocaleString()} invoices indexed in ${r.pagesFetched} calls (${r.total.toLocaleString()} total).` +
            (r.nextPage ? ` More to go — run again.` : ` Index complete.`) +
            (adopted.adopted || adopted.discarded
              ? ` Linked up ${adopted.adopted} imported lines${adopted.discarded ? `, merged ${adopted.discarded} duplicates` : ""}.`
              : "")
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-sm" onClick={() => run(false)} disabled={busy}>
          {busy ? "Indexing…" : hasCursor ? "Continue indexing" : "Build index"}
        </button>
        {hasCursor && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => run(true)}
            disabled={busy}
            title="Start again from page 1"
          >
            Restart
          </button>
        )}
      </div>
      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
