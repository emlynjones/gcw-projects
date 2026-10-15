import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";
import { billingStateOf, nextRenewal, totals } from "@/lib/recurring";
import { domainOf } from "@/lib/websites";
import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import WebsitesTable, { type WebsiteRow } from "./WebsitesTable";

export const dynamic = "force-dynamic";

export default async function WebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    client?: string;
    created?: string;
    joined?: string;
    attached?: string;
    assigned?: string;
    services?: string;
  }>;
}) {
  const {
    filter,
    client: clientFilter,
    created,
    joined,
    attached,
    assigned,
    services: assignedServices,
  } = await searchParams;

  const [websites, unlinkedDomains, clients, filteredClient, conn] = await Promise.all([
    prisma.website.findMany({
      where: clientFilter ? { clientId: clientFilter } : undefined,
      include: {
        client: { select: { id: true, name: true } },
        services: {
          include: {
            billings: true,
            _count: { select: { invoiceLines: true } },
            client: { select: { isInternal: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.recurringService.count({ where: { websiteId: null } }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    clientFilter
      ? prisma.client.findUnique({ where: { id: clientFilter }, select: { name: true } })
      : Promise.resolve(null),
    getConnection(),
  ]);

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

  const all: WebsiteRow[] = websites.map((w) => {
    const active = w.services.filter((s) => s.active);
    const next = active
      .map((s) => nextRenewal(s))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      id: w.id,
      name: w.name,
      url: w.url,
      clientId: w.clientId,
      clientName: w.client?.name ?? null,
      domains: [...new Set(w.services.map((s) => domainOf(s.label)).filter(Boolean))],
      serviceCount: w.services.length,
      kinds: w.services.reduce<Record<string, number>>((acc, s) => {
        acc[s.kind] = (acc[s.kind] ?? 0) + 1;
        return acc;
      }, {}),
      annualSell: totals(active).sell,
      annualCost: totals(active).cost,
      renewalDisplay: next ? dateFmt(next) : "",
      unbilled: active.filter(
        (s) => billingStateOf(s, s.billings, new Date(), s._count.invoiceLines) === "UNBILLED"
      ).length,
    };
  });

  const qs = (params: Record<string, string | undefined>) => {
    const merged = { filter, client: clientFilter, ...params };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const str = sp.toString();
    return `/websites${str ? `?${str}` : ""}`;
  };

  const noClient = all.filter((r) => !r.clientId).length;
  const rows =
    filter === "noclient"
      ? all.filter((r) => !r.clientId)
      : filter === "unbilled"
        ? all.filter((r) => r.unbilled > 0)
        : all;

  return (
    <>
      <div className="page-head">
        <h1>Websites</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/recurring" className="btn btn-secondary">
            Recurring services
          </Link>
          <Link href="/websites/new" className="btn btn-secondary">
            + New website
          </Link>
          <Link href="/websites/bulk" className="btn">
            Create from domains
            {unlinkedDomains > 0 ? ` (${unlinkedDomains})` : ""}
          </Link>
        </div>
      </div>

      {(created || joined) && (
        <div className="success-msg">
          Created {created ?? 0} website(s)
          {Number(joined) > 0 && ` · ${joined} joined an existing website`} · {attached} service(s)
          attached
          {Number(assigned) > 0 && ` · ${assigned} assigned to a client`}.
        </div>
      )}
      {assigned && !created && !joined && (
        <div className="success-msg">
          Assigned {assigned} website(s)
          {Number(assignedServices) > 0 && ` · ${assignedServices} service(s) moved with them`}.
        </div>
      )}

      {xeroError && (
        <div className="error-msg">
          Xero contacts unavailable — {xeroError} Local clients still work.
        </div>
      )}

      {filteredClient && (
        <p className="muted small mt">
          Showing websites for <strong>{filteredClient.name}</strong> ·{" "}
          <Link href="/websites">show all websites</Link>
        </p>
      )}

      <div className="filters">
        <Link href={qs({ filter: undefined })} className={!filter ? "active" : ""}>
          All ({all.length})
        </Link>
        <Link href={qs({ filter: "noclient" })} className={filter === "noclient" ? "active" : ""}>
          No client{noClient > 0 ? ` (${noClient})` : ""}
        </Link>
        <Link href={qs({ filter: "unbilled" })} className={filter === "unbilled" ? "active" : ""}>
          Not billed
        </Link>
      </div>

      {all.length === 0 ? (
        <p className="muted mt">
          No websites yet.{" "}
          {unlinkedDomains > 0 ? (
            <>
              You have {unlinkedDomains} domain(s) waiting —{" "}
              <Link href="/websites/bulk">create websites from them</Link>.
            </>
          ) : (
            <>
              Import domains on the <Link href="/recurring/import">recurring services import</Link> first.
            </>
          )}
        </p>
      ) : (
        <WebsitesTable rows={rows} clients={clients} xeroContacts={xeroContacts} />
      )}
    </>
  );
}
