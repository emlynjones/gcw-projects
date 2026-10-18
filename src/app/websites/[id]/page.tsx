import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { gbp, dateFmt } from "@/lib/status";
import {
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
  SERVICE_KINDS,
} from "@/lib/recurring";
import { siteKey } from "@/lib/websites";
import { xeroInvoiceUrl } from "@/lib/xero-links";
import { matchInvoiceLines, toMatchableLine, type MatchableService } from "@/lib/billing-match";
import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import { updateWebsite, createRecurringService } from "@/app/recurring-actions";
import {
  detachServiceFromWebsite,
  deleteWebsiteAndReturn,
  scanWebsiteInvoicesAction,
  linkInvoiceLineToService,
  ignoreInvoiceLine,
  unlinkInvoiceLine,
} from "@/app/website-actions";
import ServiceEditor from "@/app/components/ServiceEditor";
import WebsiteClient from "./WebsiteClient";
import RaiseInvoice from "./RaiseInvoice";
import PeriodGrid from "./PeriodGrid";
import { buildPeriodGrid } from "@/lib/billing-periods";
import { billableServices } from "@/app/website-invoice-actions";
import AttachServices, { type LooseService } from "./AttachServices";

export const dynamic = "force-dynamic";

/**
 * An invoice number that opens in Xero.
 *
 * Falls back to plain text for a line imported from CSV whose invoice wasn't in
 * the index — those carry a `csv:` placeholder rather than a real GUID, so
 * there's nothing to link to until the index catches up.
 */
function XeroRef({ id, number }: { id?: string | null; number?: string | null }) {
  const url = xeroInvoiceUrl(id);
  if (!number) return <>—</>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" title="Open in Xero">
      {number}
    </a>
  ) : (
    <>{number}</>
  );
}

export default async function WebsitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    scanned?: string;
    invoices?: string;
    lines?: string;
    linked?: string;
    pending?: string;
    cached?: string;
    scanError?: string;
    invoiced?: string;
    number?: string;
    xid?: string;
    invoiceError?: string;
    created?: string;
    error?: string;
    resnapped?: string;
    moved?: string;
    realloc?: string;
    to?: string;
  }>;
}) {
  const { id } = await params;
  const {
    scanned,
    invoices,
    lines: lineCount,
    linked,
    pending,
    cached,
    scanError,
    invoiced,
    number,
    xid,
    invoiceError,
    created,
    error,
    resnapped,
    moved,
    realloc,
    to,
  } = await searchParams;

  const website = await prisma.website.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, xeroContactId: true, isInternal: true } },
      services: {
        include: {
          billings: { orderBy: { periodStart: "desc" } },
          _count: { select: { invoiceLines: true } },
          client: { select: { isInternal: true } },
        },
        orderBy: [{ kind: "asc" }, { label: "asc" }],
      },
    },
  });
  if (!website) notFound();

  const key = siteKey(website.name);

  const [loose, clients, conn, catalogue] = await Promise.all([
    prisma.recurringService.findMany({
      where: { websiteId: null },
      include: { client: { select: { name: true } } },
      orderBy: { label: "asc" },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getConnection(),
    prisma.service.findMany({
      where: { active: true, unit: { in: ["month", "year"] } },
      select: { id: true, name: true, price: true, unit: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const billable = website.clientId ? await billableServices(website.id) : [];
  const grid = buildPeriodGrid(website.services);
  // Monthly care plans and anything without a renewal date can't sit on a year
  // grid, so they keep the owing-now list.
  const onGrid = new Set(grid.rows.map((r) => r.serviceId));
  const offGrid = billable.filter((b) => !onGrid.has(b.id));

  // The client's cached invoice lines drive both the linked view and the queue.
  const invoiceLines = website.clientId
    ? await prisma.xeroInvoiceLine.findMany({
        where: { clientId: website.clientId },
        orderBy: { invoiceDate: "desc" },
      })
    : [];

  const serviceById = new Map(website.services.map((s) => [s.id, s]));
  const linkedLines = invoiceLines.filter(
    (l) => l.recurringServiceId && serviceById.has(l.recurringServiceId)
  );

  const matchable: MatchableService[] = website.services.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    quantity: s.quantity,
    costPrice: s.costPrice,
    sellPrice: s.sellPrice,
    renewalDate: s.renewalDate,
    termMonths: s.termMonths,
  }));

  // Recomputed on every render rather than stored — a proposal is only ever a
  // view over the current data, so there's no stale queue to reconcile.
  const openLines = invoiceLines.filter((l) => !l.reviewed);
  const { proposals } = matchInvoiceLines(openLines.map(toMatchableLine), matchable);
  const proposalByLine = new Map(proposals.map((p) => [p.lineId, p]));

  const active = website.services.filter((s) => s.active);
  const { sell: totalSell, cost: totalCost } = totals(active);
  const carePlan = active.find((s) => s.kind === "CAREPLAN");
  const missingPrices = active.filter((s) => s.sellPrice <= 0);
  const reviewServices = active.filter(
    (s) => billingStateOf(s, s.billings, new Date(), s._count.invoiceLines) === "REVIEW"
  );
  // An invoice anniversary far from the supplier renewal is evidence that the
  // client billing schedule may differ. Surface that ambiguity before another
  // period is charged; the existing model deliberately keeps the confirmed
  // billing periods separate from the supplier renewal anchor.
  const anniversaryMismatches = active.filter((service) => {
    if (!service.renewalDate) return false;
    const latest = linkedLines.find((line) => line.recurringServiceId === service.id)?.invoiceDate;
    if (!latest) return false;
    const renewalDay = Date.UTC(2000, service.renewalDate.getUTCMonth(), service.renewalDate.getUTCDate());
    const invoiceDay = Date.UTC(2000, latest.getUTCMonth(), latest.getUTCDate());
    const days = Math.abs(renewalDay - invoiceDay) / 86_400_000;
    return Math.min(days, 366 - days) > 45;
  });
  const attentionCount = missingPrices.length + reviewServices.length + anniversaryMismatches.length + proposals.length;
  const financialsConfirmed = missingPrices.length === 0;

  const looseServices: LooseService[] = loose.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    provider: s.provider,
    costPrice: s.costPrice,
    clientName: s.client?.name ?? null,
    related: !!key && siteKey(s.label) === key,
  }));

  let xeroContacts: XeroContactLite[] = [];
  let xeroError: string | null = null;
  if (conn) {
    try {
      xeroContacts = await getUnlinkedXeroContacts();
    } catch (e) {
      // Local clients still work, but say so — a picker that silently loses its
      // Xero half looks like a broken connection rather than a rate limit.
      xeroError = e instanceof Error ? e.message : String(e);
    }
  }

  const websiteOptions = [{ id: website.id, name: website.name }];
  const allBillings = website.services.flatMap((s) =>
    s.billings.map((b) => ({ ...b, serviceLabel: s.label, kind: s.kind }))
  );
  allBillings.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());

  return (
    <div className="website-detail">
      <div className="page-head website-identity">
        <div>
          <div className="breadcrumb"><Link href="/websites">Websites</Link> / {website.name}</div>
          <h1>{website.name}</h1>
          {website.url && (
            <a href={website.url} target="_blank" rel="noreferrer" className="small">
              Website address ↗
            </a>
          )}
          <div className="muted small">
            Client: {website.clientId ? <Link href={`/clients/${website.clientId}`}>{website.client?.name} →</Link> : "Not assigned"}
          </div>
        </div>
        <div className="action-row">
          {attentionCount > 0 && <a href="#billing" className="btn btn-secondary">Review billing ({attentionCount})</a>}
          <a href="#add-service" className="btn">+ Add service</a>
          <details className="admin-menu"><summary className="btn btn-secondary" aria-label="Website actions">•••</summary>
            <div><a href="#advanced">Edit website / client</a><Link href="/websites">All websites</Link></div>
          </details>
        </div>
      </div>

      {realloc && (
        <div className="success-msg">
          {realloc}
          {to && <> — now allocated from {to}</>}. The invoice in Xero is unchanged; if it names
          the old dates, edit it there too.
        </div>
      )}
      {resnapped && (
        <div className="success-msg">
          Rebuilt {moved} billing period(s) for <strong>{resnapped}</strong> from its renewal date.
          Anything genuinely uninvoiced should now be offered below.
        </div>
      )}
      {error && <div className="error-msg">{error}</div>}
      {created && (
        <div className="success-msg">
          Website created.{" "}
          {website.services.length === 0 && (
            <>
              Nothing is attached to it yet — add a service below, or attach one already in the
              recurring register.
            </>
          )}
          {!website.clientId && <> Assign a client to invoice or reconcile it.</>}
        </div>
      )}
      {scanError && <div className="error-msg">{scanError}</div>}
      {xeroError && (
        <div className="error-msg">
          Xero contacts unavailable — {xeroError} Local clients still work.
        </div>
      )}
      {scanned && (
        <div className="success-msg">
          {cached
            ? "Matched against this client's invoice history, pulled a few minutes ago — no Xero calls needed."
            : `Scanned ${invoices} invoice(s), ${lineCount} line(s) refreshed from Xero.`}{" "}
          {linked} linked automatically
          {Number(pending) > 0 && ` · ${pending} need a look below`}.
        </div>
      )}

      <div className="stats website-summary">
        <div className="stat">
          <div className="label">Care plan</div>
          <div className="value summary-text">{carePlan ? carePlan.label : "No care plan linked"}</div>
          {carePlan && <div className="muted small">{gbp(carePlan.sellPrice)}/{carePlan.termMonths === 1 ? "month" : `${carePlan.termMonths} months`} · Active</div>}
        </div>
        <div className="stat"><div className="label">Annual recurring revenue</div><div className={`value${financialsConfirmed ? "" : " value-warning"}`}>{financialsConfirmed ? gbp(totalSell) : "Unconfirmed"}</div></div>
        <div className="stat"><div className="label">Annual supplier cost</div><div className="value">{gbp(totalCost)}</div></div>
        <div className="stat"><div className="label">Annual margin</div><div className={`value${financialsConfirmed ? "" : " value-warning"}`}>{financialsConfirmed ? gbp(totalSell - totalCost) : "Unconfirmed"}</div></div>
      </div>

      {attentionCount > 0 && <div className="attention-panel">
        <strong>{attentionCount} item{attentionCount === 1 ? "" : "s"} need attention</strong>
        {missingPrices.map((s) => <div key={`price-${s.id}`}>{s.label} selling price missing <a href={`#service-${s.id}`}>Set price →</a></div>)}
        {reviewServices.map((s) => <div key={`review-${s.id}`}>{s.label} billing period needs checking <a href="#billing">Review billing →</a></div>)}
        {anniversaryMismatches.map((s) => <div key={`anniversary-${s.id}`}>{s.label} invoice anniversary differs from its supplier renewal date <a href="#invoice-suggestions">Review invoice evidence →</a></div>)}
        {proposals.length > 0 && <div>{proposals.length} invoice suggestion{proposals.length === 1 ? "" : "s"} need a decision <a href="#invoice-suggestions">Review suggestions →</a></div>}
      </div>}

      <details className="card website-admin" id="advanced">
        <summary><strong>Advanced settings</strong></summary>
        <div className="mt">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <WebsiteClient
            websiteId={website.id}
            clientId={website.clientId}
            clientName={website.client?.name ?? null}
            clients={clients}
            xeroContacts={xeroContacts}
          />
          {website.clientId && (
            <Link href={`/clients/${website.clientId}`} className="muted small">
              Open client →
            </Link>
          )}
        </div>

          <form action={updateWebsite.bind(null, website.id)} className="stack mt">
            <div className="row">
              <div className="field">
                <label htmlFor="w-name">Name</label>
                <input id="w-name" name="name" defaultValue={website.name} required />
              </div>
              <div className="field">
                <label htmlFor="w-url">URL</label>
                <input id="w-url" name="url" defaultValue={website.url ?? ""} placeholder="https://…" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="w-notes">Notes</label>
              <input id="w-notes" name="notes" defaultValue={website.notes ?? ""} />
            </div>
            <div>
              <button type="submit" className="btn btn-sm">
                Save
              </button>
            </div>
          </form>
        </div>
      </details>

      <div className="card website-billing" id="billing">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Billing periods</h2>
          <span className="small">
            {grid.totalGaps > 0 && (
              <span className="paid-no">
                {grid.totalGaps} year{grid.totalGaps === 1 ? "" : "s"} skipped
              </span>
            )}
            {grid.totalGaps > 0 && grid.totalUnknown > 0 && <span className="muted"> · </span>}
            {grid.totalUnknown > 0 && (
              <span className="muted">
                {grid.totalUnknown} with no billing record
              </span>
            )}
          </span>
        </div>
        <p className="muted small">
          Each year this site&apos;s domains and hosting have run, and what was invoiced for it.
          Tick anything unbilled — including past years — and raise one draft covering the lot.
        </p>
        {invoiced && (
          <div className="success-msg">
            Draft{" "}
            {number ? (
              <strong>
                <XeroRef id={xid} number={number} />
              </strong>
            ) : (
              "invoice"
            )}{" "}
            created in Xero with {invoiced} line(s), and recorded against the period so it
            won&apos;t show as unbilled.{" "}
            {xid && (
              <a href={xeroInvoiceUrl(xid) ?? "#"} target="_blank" rel="noreferrer">
                Open it in Xero
              </a>
            )}{" "}
            to approve and send.
          </div>
        )}
        {invoiceError && <div className="error-msg">{invoiceError}</div>}
        {!website.clientId ? (
          <p className="muted">Assign this website to a client before invoicing.</p>
        ) : !conn ? (
          <p className="muted">
            Xero isn&apos;t connected — connect it in <Link href="/settings">Settings</Link>.
          </p>
        ) : (
          <>
            <PeriodGrid
              websiteId={website.id}
              grid={grid}
              canRaise={!!conn}
              defaultReference={website.name}
            />
            {offGrid.length > 0 && (
              <details className="archive mt">
                <summary>
                  Other services — {offGrid.length} not on the year grid
                  {offGrid.some((o) => o.kind === "CAREPLAN") && " (care plans bill monthly)"}
                </summary>
                <div className="mt">
                  <RaiseInvoice
                    websiteId={website.id}
                    services={offGrid}
                    defaultReference={website.name}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </div>

      <div className="card website-services">
        <h2>Recurring services</h2>
        {website.services.length === 0 ? (
          <p className="muted">
            Nothing attached yet — use <strong>Attach services</strong> below, or add one.
          </p>
        ) : (
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
              {website.services.map((s) => {
                const state = billingStateOf(s, s.billings, new Date(), s._count.invoiceLines);
                const period = currentPeriod(s);
                const days = daysUntilRenewal(s);
                const next = nextRenewal(s);
                return (
                  <tr key={s.id} id={`service-${s.id}`} style={s.active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <details>
                        <summary>
                          {s.label}
                          {!s.active && <span className="badge ml-1">inactive</span>}
                        </summary>
                        <ServiceEditor service={s} websites={websiteOptions} catalogue={catalogue} />
                      </details>
                    </td>
                    <td>
                      <span className="badge badge-type">{serviceKindLabel(s.kind)}</span>
                    </td>
                    <td className="muted small">{s.provider ?? "Provider not set"}</td>
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
                        "Renewal date missing"
                      )}
                    </td>
                    <td className="num">{s.quantity !== 1 ? s.quantity : "1"}</td>
                    <td className="num">{gbp(annualCost(s))}</td>
                    <td className="num">{s.sellPrice > 0 ? gbp(annualSell(s)) : <span className="paid-no">Price missing</span>}</td>
                    <td>
                      <span
                        className={`badge ${state === "BILLED" || state === "NOT_BILLABLE" ? "badge-life-COMPLETE" : state === "REVIEW" ? "badge-review" : "badge-life-LOST"}`}
                      >
                        {billingStateLabel(state)}
                      </span>
                    </td>
                    <td>
                      <form action={detachServiceFromWebsite.bind(null, s.id)}>
                        <button
                          type="submit"
                          className="btn btn-ghost btn-sm"
                          title="Detach from this website (the service is kept)"
                        >
                          Detach
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <details className="mt" id="add-service">
          <summary>Add a service</summary>
          <form action={createRecurringService} className="stack mt">
            <input type="hidden" name="websiteId" value={website.id} />
            {website.clientId && <input type="hidden" name="clientId" value={website.clientId} />}
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
                <select id="s-kind" name="kind" defaultValue="HOSTING">
                  {SERVICE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {serviceKindLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="s-label">Label</label>
                <input id="s-label" name="label" defaultValue={website.name} required />
              </div>
              <div className="field">
                <label htmlFor="s-provider">Provider</label>
                <input id="s-provider" name="provider" placeholder="Cloud.Market" />
              </div>
            </div>
            <div className="row">
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
          <div className="attach-inside-flow">
            <h3>Or attach an existing service</h3>
            <AttachServices websiteId={website.id} services={looseServices} />
          </div>
        </details>
      </div>

      <div className="card website-invoices" id="invoice-suggestions">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <div>
            <h2>Invoice reconciliation</h2>
            <div className="muted small">
              {proposals.length} suggested · {openLines.length - proposals.length} unmatched · {linkedLines.length} linked
            </div>
          </div>
          {website.clientId && website.services.length > 0 && (
            <form action={scanWebsiteInvoicesAction.bind(null, website.id)}>
              <button type="submit" className="btn btn-secondary btn-sm">
                Scan invoices
              </button>
            </form>
          )}
        </div>

        {!website.clientId ? (
          <p className="muted">Assign a client to reconcile this website against their invoices.</p>
        ) : website.services.length === 0 ? (
          <p className="muted">Attach a service first — there&apos;s nothing to match invoices to.</p>
        ) : (
          <>
            <p className="muted small">
              Scanning refreshes this client&apos;s invoice history from Xero, then links the lines it
              can identify beyond doubt. Anything ambiguous — or invoiced a long way from the renewal
              it would cover — waits for you below.
              {!website.client?.xeroContactId && (
                <>
                  {" "}
                  <strong>This client isn&apos;t linked to Xero</strong>, so only already-cached lines
                  are available.
                </>
              )}
            </p>

            {proposals.length > 0 && (
              <>
                <h3 className="mt">Suggested links ({proposals.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th>Suggested service</th>
                      <th>Period it would cover</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p) => {
                      const line = openLines.find((l) => l.id === p.lineId)!;
                      return (
                        <tr key={p.lineId}>
                          <td className="muted small">
                            <XeroRef id={line.xeroInvoiceId} number={line.xeroNumber} />
                            <div>{dateFmt(line.invoiceDate)}</div>
                          </td>
                          <td>{line.description}</td>
                          <td className="num">{gbp(line.lineAmount)}</td>
                          <td>
                            <form
                              action={linkInvoiceLineToService.bind(null, p.lineId, website.id)}
                              style={{ display: "flex", gap: 6, alignItems: "center" }}
                            >
                              <select name="serviceId" defaultValue={p.serviceId}>
                                {website.services.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label} ({serviceKindLabel(s.kind)})
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className="btn btn-secondary btn-sm">
                                Link
                              </button>
                            </form>
                            <span className="muted small">{p.reason}</span>
                          </td>
                          <td className="muted small">{periodLabel(p.period)}</td>
                          <td>
                            <form action={ignoreInvoiceLine.bind(null, p.lineId, website.id)}>
                              <button type="submit" className="btn btn-ghost btn-sm">
                                Not ours
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {linkedLines.length > 0 && (
              <>
                <h3 className="mt">Linked ({linkedLines.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th>Service</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {linkedLines.map((l) => (
                      <tr key={l.id}>
                        <td className="muted small">
                          <XeroRef id={l.xeroInvoiceId} number={l.xeroNumber} />
                          <div>{dateFmt(l.invoiceDate)}</div>
                        </td>
                        <td>{l.description}</td>
                        <td className="num">{gbp(l.lineAmount)}</td>
                        <td>{serviceById.get(l.recurringServiceId!)?.label}</td>
                        <td>
                          <form action={unlinkInvoiceLine.bind(null, l.id, website.id)}>
                            <button type="submit" className="btn btn-ghost btn-sm">
                              Unlink
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {openLines.length > proposals.length && (
              <section className="mt manual-invoice-links">
                <h3>Link other invoice lines ({openLines.length - proposals.length})</h3>
                <p className="muted small">
                  Choose the recurring service each unmatched Xero line pays for, or mark it as unrelated to this website.
                </p>
                <table className="mt">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th>Link to</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {openLines
                      .filter((l) => !proposalByLine.has(l.id))
                      .map((l) => (
                        <tr key={l.id}>
                          <td className="muted small">
                            <XeroRef id={l.xeroInvoiceId} number={l.xeroNumber} />
                            <div>{dateFmt(l.invoiceDate)}</div>
                          </td>
                          <td>{l.description}</td>
                          <td className="num">{gbp(l.lineAmount)}</td>
                          <td>
                            <form
                              action={linkInvoiceLineToService.bind(null, l.id, website.id)}
                              style={{ display: "flex", gap: 6, alignItems: "center" }}
                            >
                              <select name="serviceId" defaultValue="">
                                <option value="">— pick a service —</option>
                                {website.services.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label} ({serviceKindLabel(s.kind)})
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className="btn btn-secondary btn-sm">
                                Link
                              </button>
                            </form>
                          </td>
                          <td>
                            <form action={ignoreInvoiceLine.bind(null, l.id, website.id)}>
                              <button type="submit" className="btn btn-ghost btn-sm">
                                Not ours
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            )}

            {invoiceLines.length === 0 && (
              <p className="muted mt">
                No invoice lines cached for this client yet. Hit <strong>Scan invoices</strong>.
              </p>
            )}
          </>
        )}
      </div>

      <div className="card website-history">
        <h2>Billing history</h2>
        {allBillings.length === 0 ? (
          <p className="muted">
            Nothing recorded yet. Linking an invoice line above writes the period it covers here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Period</th>
                <th className="num">Amount</th>
                <th>Invoice</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {allBillings.map((b) => (
                <tr key={b.id}>
                  <td>{b.serviceLabel}</td>
                  <td className="muted small">
                    {periodLabel({ start: b.periodStart, end: b.periodEnd })}
                  </td>
                  <td className="num">{gbp(b.amount)}</td>
                  <td className="muted small">
                    <XeroRef id={b.xeroInvoiceId} number={b.xeroNumber} />
                    {b.xeroStatus && <span className={`badge ml-1 badge-xero-${b.xeroStatus}`}>{b.xeroStatus}</span>}
                  </td>
                  <td className="muted small">{b.matchedBy.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="card website-danger" id="advanced-delete">
        <summary><strong>Delete website</strong></summary>
        <div className="mt">
        <form action={deleteWebsiteAndReturn.bind(null, website.id)}>
          <button type="submit" className="btn btn-danger btn-sm">
            Delete website
          </button>
          <span className="muted small ml-1">
            Its {website.services.length} service(s) are kept, just ungrouped.
          </span>
        </form>
        </div>
      </details>
    </div>
  );
}
