"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncXeroItems, type ItemSyncResult } from "@/app/xero-item-actions";

/** The only thing on this screen that talks to Xero — one call, on demand. */
export default function ItemSync({ total }: { total: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ItemSyncResult | null>(null);
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const r = await syncXeroItems();
            setResult(r);
            if (!r.error) router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Syncing…" : total ? "Re-sync product list" : "Sync product list from Xero"}
      </button>
      <span className="muted small" style={{ marginLeft: 8 }}>
        one API call
      </span>

      {result?.error && <div className="error-msg mt">{result.error}</div>}
      {result && !result.error && (
        <div className="success-msg mt">
          {result.synced} product(s) cached
          {result.removed > 0 && <> · {result.removed} no longer in Xero, removed</>}. Mapping below
          is offline from here.
        </div>
      )}
    </div>
  );
}
