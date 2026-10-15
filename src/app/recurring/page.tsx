import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";
import {
  SERVICE_KINDS,
  serviceKindLabel,
  isServiceKind,
  billingStateOf,
  currentPeriod,
  periodLabel,
  daysUntilRenewal,
  nextRenewal,
  annualCost,
  annualSell,
} from "@/lib/recurring";
import RecurringTable, { type RecurringRow } from "./RecurringTable";

export const dynamic = "force-dynamic";

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    state?: string;
    imported?: string;
    created?: string;
    updated?: string;
    matched?: string;
    unassigned?: string;
    websites?: string;
  }>;
}) {
  const { kind, state, imported, created, updated, matched, unassigned, websites } =
    await searchParams;
  const kindFilter = kind && isServiceKind(kind) ? kind : undefined;

  const services = await prisma.recurringService.findMany({
    where: kindFilter ? { kind: kindFilter } : undefined,
    include: {
      client: { select: { name: true, isInternal: true } },
      website: { select: { id: true, name: true } },
      billings: true,
      _count: { select: { invoiceLines: true } },
    },
    orderBy: [{ renewalDate: "asc" }, { label: "asc" }],
  });

  // Period maths runs here so the client component stays presentational.
  const all: RecurringRow[] = services.map((s) => {
    const period = currentPeriod(s);
    const next = nextRenewal(s);
    return {
      id: s.id,
      kind: s.kind,
      label: s.label,
      provider: s.provider,
      quantity: s.quantity,
      annualCost: annualCost(s),
      annualSell: annualSell(s),
      renewalDate: s.renewalDate ? s.renewalDate.toISOString() : null,
      // The *next* renewal, not the stored date — a supplier export can be years
      // stale, and what matters operationally is when it next falls due.
      renewalDisplay: next ? dateFmt(next) : "",
      periodDisplay: period ? periodLabel(period) : "",
      daysUntil: daysUntilRenewal(s),
      state: billingStateOf(s, s.billings, new Date(), s._count.invoiceLines),
      active: s.active,
      managedBy: s.managedBy,
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
      clientId: s.clientId,
      clientName: s.client?.name ?? null,
      websiteName: s.website?.name ?? null,
      websiteId: s.websiteId,
    };
  });

  const unassignedCount = all.filter((r) => !r.clientId).length;
  const unattached = await prisma.recurringService.count({ where: { websiteId: null } });
  const rows =
    state === "unassigned"
      ? all.filter((r) => !r.clientId)
      : state === "unbilled"
        ? all.filter((r) => r.state === "UNBILLED" && r.active)
        : state === "review"
          ? all.filter((r) => r.state === "REVIEW" && r.active)
        : all;

  const qs = (params: Record<string, string | undefined>) => {
    const merged = { kind: kindFilter, state, ...params };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    const str = s.toString();
    return str ? `?${str}` : "";
  };

  return (
    <>
      <div className="page-head">
        <h1>Recurring services</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/recurring/dashboard" className="btn btn-secondary">
            Dashboard
          </Link>
          <Link href="/invoices/run" className="btn">
            Billing run
          </Link>
          <Link href="/recurring/careplans" className="btn btn-secondary">
          Care plans
        </Link>
        <Link href="/recurring/microsoft-365" className="btn btn-secondary">
          Microsoft 365
        </Link>
        <Link href="/reports/recurring" className="btn btn-secondary">
            Not yet billed
          </Link>
          <Link href="/invoices/review" className="btn btn-secondary">
            Invoice matches
          </Link>
          <Link href="/websites" className="btn btn-secondary">
            Websites
          </Link>
          <Link href="/recurring/import" className="btn">
            Import CSV
          </Link>
        </div>
      </div>

      {unattached > 0 && (
        <p className="muted small mt">
          {unattached} service(s) aren&apos;t attached to a website yet.{" "}
          <Link href="/websites/bulk">Group them into websites</Link> — that&apos;s what makes them
          assignable to a client and billable in bulk.
        </p>
      )}

      {imported && (
        <div className="success-msg">
          Imported: {created} created, {updated} updated · {matched} matched to a client,{" "}
          {unassigned} unassigned
          {Number(websites) > 0 && ` · ${websites} website(s) created`}.
          {Number(unassigned) > 0 && (
            <div className="small mt">
              Use the <strong>Unassigned</strong> filter below to assign the rest.
            </div>
          )}
        </div>
      )}

      <div className="filters">
        <Link href={`/recurring${qs({ kind: undefined })}`} className={!kindFilter ? "active" : ""}>
          All types
        </Link>
        {SERVICE_KINDS.map((k) => (
          <Link key={k} href={`/recurring${qs({ kind: k })}`} className={kindFilter === k ? "active" : ""}>
            {serviceKindLabel(k)}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <Link href={`/recurring${qs({ state: undefined })}`} className={!state ? "active" : ""}>
          All
        </Link>
        <Link
          href={`/recurring${qs({ state: "review" })}`}
          className={state === "review" ? "active" : ""}
        >
          Review links ({all.filter((r) => r.state === "REVIEW" && r.active).length})
        </Link>
        <Link
          href={`/recurring${qs({ state: "unbilled" })}`}
          className={state === "unbilled" ? "active" : ""}
        >
          Not billed
        </Link>
        <Link
          href={`/recurring${qs({ state: "unassigned" })}`}
          className={state === "unassigned" ? "active" : ""}
        >
          Unassigned{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
        </Link>
      </div>

      {state === "unassigned" && (
        <p className="muted small mt">
          These aren&apos;t linked to a client yet, so they can&apos;t be billed. Open a service from a
          client page to assign it, or import will match them automatically once billing history is
          synced.
        </p>
      )}

      <RecurringTable rows={rows} />

      {all.length === 0 && (
        <p className="muted mt">
          Nothing yet. Add domains, hosting or Office 365 licences from a{" "}
          <Link href="/clients">client page</Link>.
        </p>
      )}
    </>
  );
}
