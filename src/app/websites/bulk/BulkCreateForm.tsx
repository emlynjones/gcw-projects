"use client";

import { useMemo, useState } from "react";
import ClientPicker, { type ClientOption } from "@/app/components/ClientPicker";
import { importOneXeroContact } from "@/app/xero-actions";
import { createWebsitesFromDomains } from "@/app/website-actions";
import { serviceKindLabel } from "@/lib/recurring";
import type { Confidence } from "@/lib/matching";
import type { XeroContactLite } from "@/lib/xero";

export type ProposedWebsite = {
  id: string;
  name: string;
  domains: string[];
  serviceIds: string[];
  clientId: string | null;
  clientName: string | null;
  confidence: Confidence;
  reason: string;
  /** What this group is made of, e.g. { HOSTING: 1, DOMAIN: 2 }. */
  kinds: Record<string, number>;
  /** An existing website covering the same name — pre-selected, not applied. */
  suggestedWebsiteId: string | null;
  suggestedWebsiteName: string | null;
  suggestedWebsiteClient: string | null;
};

const PAGE_SIZE = 20;

const CONFIDENCE_BADGE: Record<Confidence, string> = {
  HIGH: "badge-life-COMPLETE",
  MEDIUM: "badge-match",
  LOW: "badge-stage",
  NONE: "",
};

export type ExistingWebsite = { id: string; name: string; clientName: string | null };

export default function BulkCreateForm({
  proposals,
  clients: initialClients,
  xeroContacts,
  existingWebsites,
}: {
  proposals: ProposedWebsite[];
  clients: ClientOption[];
  xeroContacts: XeroContactLite[];
  existingWebsites: ExistingWebsite[];
}) {
  const [clients, setClients] = useState(initialClients);
  const [query, setQuery] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [clientOverrides, setClientOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"all" | "attach" | "new" | "hosting" | "o365">("all");
  /**
   * Row id → the existing website to attach to; "" means create a new one.
   * Seeded from the server's suggestion so a domain whose site already exists
   * defaults to joining it rather than making a duplicate.
   */
  const [attachTo, setAttachTo] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposals.filter((p) => p.suggestedWebsiteId).map((p) => [p.id, p.suggestedWebsiteId!])
    )
  );

  const q = query.trim().toLowerCase();

  const counts = useMemo(
    () => ({
      attach: proposals.filter((p) => p.suggestedWebsiteId).length,
      new: proposals.filter((p) => !p.suggestedWebsiteId).length,
      hosting: proposals.filter((p) => p.kinds.HOSTING).length,
      o365: proposals.filter((p) => p.kinds.O365).length,
    }),
    [proposals]
  );

  const shown = useMemo(() => {
    const byView = proposals.filter((p) => {
      if (view === "attach") return !!p.suggestedWebsiteId;
      if (view === "new") return !p.suggestedWebsiteId;
      if (view === "hosting") return !!p.kinds.HOSTING;
      if (view === "o365") return !!p.kinds.O365;
      return true;
    });
    if (!q) return byView;
    return byView.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.domains.some((d) => d.includes(q)) ||
        p.clientName?.toLowerCase().includes(q)
    );
  }, [proposals, q, view]);

  // Paging is display only — the form still submits every row that isn't
  // skipped, on this page or any other. Row state lives in these maps rather
  // than in the inputs, so edits survive turning the page.
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageItems = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const nameOf = (p: ProposedWebsite) => names[p.id] ?? p.name;
  const clientOf = (p: ProposedWebsite) =>
    p.id in clientOverrides ? clientOverrides[p.id] : (p.clientId ?? "");
  const clientNameOf = (p: ProposedWebsite) => {
    const id = clientOf(p);
    return id ? (clients.find((c) => c.id === id)?.name ?? null) : null;
  };

  const chosen = proposals.filter((p) => !skipped.has(p.id));

  // The form posts one JSON blob, same as the CSV import — keeps 144 rows of
  // per-row state out of the FormData encoding. A row carrying a websiteId is an
  // attach, not a create; the server ignores name and client for those, since
  // the website it's joining already has both.
  const payload = useMemo(
    () =>
      JSON.stringify(
        proposals
          .filter((p) => !skipped.has(p.id))
          .map((p) => {
            const websiteId = attachTo[p.id];
            if (websiteId) return { websiteId, serviceIds: p.serviceIds };
            return {
              name: (names[p.id] ?? p.name).trim(),
              url: null,
              clientId:
                (p.id in clientOverrides ? clientOverrides[p.id] : (p.clientId ?? "")) || null,
              serviceIds: p.serviceIds,
            };
          })
      ),
    [proposals, skipped, names, clientOverrides, attachTo]
  );

  const attachCount = chosen.filter((p) => attachTo[p.id]).length;
  const createCount = chosen.length - attachCount;
  const withClient = chosen.filter((p) => attachTo[p.id] || clientOf(p)).length;
  const allShownSkipped = shown.length > 0 && shown.every((p) => skipped.has(p.id));

  const pageIncluded = pageItems.filter((p) => !skipped.has(p.id)).length;
  const allPageIncluded = pageItems.length > 0 && pageIncluded === pageItems.length;

  function toggle(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Tick or untick every row currently on screen. */
  function setPageIncluded(include: boolean) {
    setSkipped((prev) => {
      const next = new Set(prev);
      for (const p of pageItems) {
        if (include) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  function addClient(client: ClientOption) {
    setClients((prev) =>
      prev.some((c) => c.id === client.id)
        ? prev
        : [...prev, client].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  return (
    <form action={createWebsitesFromDomains}>
      <input type="hidden" name="payload" value={payload} />

      <div className="filters mt">
        {(
          [
            ["all", `All (${proposals.length})`],
            ["attach", `Joining a site you have (${counts.attach})`],
            ["new", `New website (${counts.new})`],
            ["hosting", `Hosting (${counts.hosting})`],
            ["o365", `Office 365 (${counts.o365})`],
          ] as const
        ).map(([key, label]) => (
          <a
            key={key}
            href="#"
            className={view === key ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              setView(key);
              setPage(0);
            }}
          >
            {label}
          </a>
        ))}
      </div>

      {view === "attach" && (
        <p className="muted small mt">
          Each of these already matches a website you have, so they&apos;ll join it and take its
          client. Nothing new is created — a quick way to clear the easy ones first.
        </p>
      )}
      {view === "new" && (
        <p className="muted small mt">
          No existing website matches these, so each creates one. Hosting with no matching domain
          lands here — a site you host but don&apos;t hold the domain for.
        </p>
      )}

      <div className="row mt" style={{ alignItems: "center" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search domains or clients…"
          style={{ maxWidth: 320 }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPageIncluded(true)}>
          Tick this page
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPageIncluded(false)}>
          Untick this page
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setSkipped((prev) => {
              const next = new Set(prev);
              for (const p of shown) {
                if (allShownSkipped) next.delete(p.id);
                else next.add(p.id);
              }
              return next;
            })
          }
        >
          {allShownSkipped ? "Tick" : "Untick"} all {shown.length} {q ? "matching" : ""}
        </button>
      </div>

      <p className="muted small mt">
        Showing {shown.length === 0 ? 0 : current * PAGE_SIZE + 1}–
        {current * PAGE_SIZE + pageItems.length} of {shown.length}
        {q && ` matching "${query.trim()}"`} · {pageIncluded} of {pageItems.length} ticked on this page
      </p>

      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <input
                type="checkbox"
                checked={allPageIncluded}
                ref={(el) => {
                  if (el) el.indeterminate = pageIncluded > 0 && !allPageIncluded;
                }}
                onChange={() => setPageIncluded(!allPageIncluded)}
                style={{ width: "auto" }}
                aria-label="Tick or untick every row on this page"
              />
            </th>
            <th style={{ width: 260 }}>Website name</th>
            <th>Contains</th>
            <th>Domains</th>
            <th style={{ width: 280 }}>Client</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((p) => {
            const include = !skipped.has(p.id);
            const joining = attachTo[p.id] ?? "";
            const joined = joining ? existingWebsites.find((w) => w.id === joining) : undefined;
            return (
              <tr key={p.id} style={include ? undefined : { opacity: 0.45 }}>
                <td>
                  <input
                    type="checkbox"
                    checked={include}
                    onChange={() => toggle(p.id)}
                    style={{ width: "auto" }}
                    aria-label={`Include ${p.name}`}
                  />
                </td>
                <td>
                  <select
                    value={joining}
                    onChange={(e) => setAttachTo((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    disabled={!include || existingWebsites.length === 0}
                    aria-label={`New or existing website for ${p.name}`}
                  >
                    <option value="">Create new website…</option>
                    {existingWebsites.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.clientName ? ` — ${w.clientName}` : ""}
                      </option>
                    ))}
                  </select>
                  {!joining && (
                    <input
                      className="mt"
                      value={nameOf(p)}
                      onChange={(e) => setNames((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      disabled={!include}
                      aria-label={`Name for ${p.name}`}
                    />
                  )}
                </td>
                <td className="muted small">
                  {Object.entries(p.kinds)
                    .map(([k, n]) => `${n} ${serviceKindLabel(k).toLowerCase()}`)
                    .join(", ")}
                </td>
                <td className="muted small">{p.domains.join(", ") || "—"}</td>
                <td>
                  {joining ? (
                    <span className="muted small">
                      {joined?.clientName ?? "No client on that website"}
                    </span>
                  ) : (
                    <>
                      {editing === p.id ? (
                        <ClientPicker
                          clients={clients}
                          xeroContacts={xeroContacts}
                          importAction={importOneXeroContact}
                          value={clientOf(p)}
                          onChange={(id) => {
                            setClientOverrides((prev) => ({ ...prev, [p.id]: id }));
                            setEditing(null);
                          }}
                          onImported={addClient}
                        />
                      ) : (
                        <button
                          type="button"
                          className={clientOf(p) ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
                          onClick={() => setEditing(p.id)}
                          disabled={!include}
                        >
                          {clientNameOf(p) ?? "Pick a client"}
                        </button>
                      )}
                      {clientOf(p) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm ml-1"
                          onClick={() => setClientOverrides((prev) => ({ ...prev, [p.id]: "" }))}
                          title="Leave unassigned"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </td>
                <td className="muted small">
                  {joining ? (
                    <>
                      <span className="badge badge-match">attach</span>{" "}
                      {joining === p.suggestedWebsiteId
                        ? `Same name as your existing ${p.suggestedWebsiteName} — joins it and takes its client`
                        : `Joins ${joined?.name}, taking its client`}
                    </>
                  ) : clientOf(p) === (p.clientId ?? "") ? (
                    <>
                      {p.confidence !== "NONE" && (
                        <span className={`badge ${CONFIDENCE_BADGE[p.confidence]}`}>
                          {p.confidence.toLowerCase()}
                        </span>
                      )}{" "}
                      {p.reason}
                    </>
                  ) : (
                    "Chosen by you"
                  )}
                </td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Nothing in this view{q ? ` matching "${query.trim()}"` : ""}.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div
          className="mt"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(0)}
            disabled={current === 0}
          >
            « First
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
          >
            ‹ Previous
          </button>
          <span className="muted small">
            Page {current + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
          >
            Next ›
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPage(pageCount - 1)}
            disabled={current >= pageCount - 1}
          >
            Last »
          </button>
        </div>
      )}

      <div className="mt">
        <button type="submit" className="btn" disabled={chosen.length === 0}>
          {attachCount === 0
            ? `Create ${createCount} website${createCount === 1 ? "" : "s"}`
            : createCount === 0
              ? `Attach ${attachCount} to existing`
              : `Create ${createCount}, attach ${attachCount}`}
        </button>
        <span className="muted small ml-1">
          {withClient} with a client, {chosen.length - withClient} unassigned (you can assign those from
          the websites table afterwards).
          {pageCount > 1 && " Everything ticked is applied, not just this page."}
        </span>
      </div>
    </form>
  );
}
