"use client";

import { useMemo, useState } from "react";
import { attachServicesToWebsite } from "@/app/website-actions";
import { serviceKindLabel } from "@/lib/recurring";
import { gbp } from "@/lib/status";

export type LooseService = {
  id: string;
  kind: string;
  label: string;
  provider: string | null;
  costPrice: number;
  clientName: string | null;
  /** True when this shares the website's name — the likely candidates. */
  related: boolean;
};

/**
 * Attach services that aren't on any website yet.
 *
 * Ones sharing this website's domain name are shown first and by default,
 * because those are the hosting/O365 rows that belong to it — but the full list
 * is one click away, since a service's label doesn't always name its site.
 */
export default function AttachServices({
  websiteId,
  services,
}: {
  websiteId: string;
  services: LooseService[];
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const related = services.filter((s) => s.related);
  const q = query.trim().toLowerCase();

  const shown = useMemo(() => {
    const pool = showAll || related.length === 0 ? services : related;
    if (!q) return pool.slice(0, 200);
    return pool
      .filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.provider?.toLowerCase().includes(q) ||
          s.clientName?.toLowerCase().includes(q)
      )
      .slice(0, 200);
  }, [services, related, showAll, q]);

  if (services.length === 0) {
    return <p className="muted small">Every service is already attached to a website.</p>;
  }

  return (
    <form action={attachServicesToWebsite.bind(null, websiteId)}>
      <div className="row" style={{ alignItems: "center" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search unattached services…"
          style={{ maxWidth: 300 }}
        />
        {related.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? `Show only matching (${related.length})` : `Show all (${services.length})`}
          </button>
        )}
      </div>

      <table className="mt">
        <thead>
          <tr>
            <th style={{ width: 30 }}></th>
            <th>Service</th>
            <th>Type</th>
            <th>Provider</th>
            <th>Client</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id}>
              <td>
                <input
                  type="checkbox"
                  name="serviceId"
                  value={s.id}
                  defaultChecked={s.related && !showAll}
                  style={{ width: "auto" }}
                  aria-label={`Attach ${s.label}`}
                />
              </td>
              <td>{s.label}</td>
              <td>
                <span className="badge badge-type">{serviceKindLabel(s.kind)}</span>
              </td>
              <td className="muted small">{s.provider ?? "—"}</td>
              <td className="muted small">{s.clientName ?? "—"}</td>
              <td className="num">{gbp(s.costPrice)}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No unattached services match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt">
        <button type="submit" className="btn btn-secondary btn-sm">
          Attach selected
        </button>
      </div>
    </form>
  );
}
