import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { groupServicesIntoWebsites, groupKey } from "@/lib/websites";
import { buildMatchContext } from "@/lib/match-context";
import { suggestMatch, type Confidence } from "@/lib/matching";
import { getConnection, getUnlinkedXeroContacts, type XeroContactLite } from "@/lib/xero";
import BulkCreateForm, { type ProposedWebsite } from "./BulkCreateForm";

export const dynamic = "force-dynamic";

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

export default async function BulkCreateWebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const [loose, clients, existingWebsites, conn] = await Promise.all([
    prisma.recurringService.findMany({
      where: { websiteId: null },
      select: { id: true, label: true, clientId: true, kind: true },
      orderBy: { label: "asc" },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.website.findMany({
      select: { id: true, name: true, client: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    getConnection(),
  ]);

  const groups = groupServicesIntoWebsites(loose);
  const grouped = new Set(groups.flatMap((g) => g.serviceIds));
  const skipped = loose.filter((s) => !grouped.has(s.id));

  // This page only ever lists what *isn't* on a website yet, so without saying
  // how many are already done it reads as though domains have gone missing.
  const alreadyAttached = await prisma.recurringService.count({
    where: { websiteId: { not: null } },
  });

  // Attribute each group using the same evidence the CSV import uses — billing
  // history first, then existing websites, dev sites, email, name.
  const ctx = await buildMatchContext();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  // A website already covering this group's name is far better evidence than any
  // client guess: hosting for acme.com belongs on the existing acme.co.uk site.
  // Offered pre-selected, never applied on its own — the row still has to be
  // submitted, and the name and target stay editable.
  const websiteByKey = new Map<string, { id: string; name: string; clientName: string | null }>();
  for (const w of existingWebsites) {
    const k = groupKey(w.name);
    if (k && !websiteByKey.has(k)) {
      websiteByKey.set(k, { id: w.id, name: w.name, clientName: w.client?.name ?? null });
    }
  }

  const proposals: ProposedWebsite[] = groups.map((g) => {
    let best = suggestMatch(g.primaryDomain, ctx);
    for (const domain of g.domains) {
      const alt = suggestMatch(domain, ctx);
      if (RANK[alt.confidence] > RANK[best.confidence]) best = alt;
    }

    // A service that already carries a client outranks any guess.
    const clientId = g.clientId ?? (best.clientId || null);
    const reason = g.clientId
      ? "Already assigned on the domain"
      : best.clientId
        ? best.reason
        : "No match — pick a client, or leave it for later";

    const existing = websiteByKey.get(g.key);

    return {
      id: g.id,
      name: g.primaryDomain,
      domains: g.domains,
      serviceIds: g.serviceIds,
      clientId,
      clientName: clientId ? (clientName.get(clientId) ?? null) : null,
      confidence: g.clientId ? "HIGH" : best.clientId ? best.confidence : "NONE",
      reason,
      kinds: g.kinds,
      suggestedWebsiteId: existing?.id ?? null,
      suggestedWebsiteName: existing?.name ?? null,
      suggestedWebsiteClient: existing?.clientName ?? null,
    };
  });

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

  return (
    <>
      <div className="page-head">
        <h1>Create websites from domains</h1>
        <Link href="/websites" className="btn btn-secondary">
          ← Back to websites
        </Link>
      </div>

      {error && <div className="error-msg">Something went wrong reading the form. Try again.</div>}

      {xeroError && (
        <div className="error-msg">
          Xero contacts unavailable — {xeroError} Local clients still work.
        </div>
      )}

      <p className="muted small">
        This page lists only what <strong>isn&apos;t</strong> on a website yet.{" "}
        {alreadyAttached > 0 ? (
          <>
            The other {alreadyAttached} service(s) are already grouped and live under{" "}
            <Link href="/websites">Websites</Link> — they haven&apos;t gone anywhere. The full list of
            everything is on <Link href="/recurring">Recurring services</Link>.
          </>
        ) : (
          <>
            Nothing is grouped yet. The full list is on{" "}
            <Link href="/recurring">Recurring services</Link>.
          </>
        )}
      </p>

      {proposals.length === 0 ? (
        <div className="card">
          <p className="muted">
            Every service is already attached to a website. Nothing left to group.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="muted small">
            {proposals.length} website(s) proposed from {grouped.size} unattached service(s). Domains
            sharing a name are grouped into one website — <code>acme.co.uk</code> and{" "}
            <code>acme.com</code> are the same site — and the name is editable before anything is
            written. Clients suggested from billing history are the reliable ones; anything weaker is
            a hint, so check it or leave the website unassigned.
            {skipped.length > 0 && (
              <>
                {" "}
                {skipped.length} service(s) have no recognisable domain and aren&apos;t listed — attach
                those from a website page.
              </>
            )}
          </p>
          <p className="muted small">
            A domain that belongs to a site you already have doesn&apos;t need a new website — switch
            the row to <strong>Attach to existing</strong> and pick it. That groups the domain and
            gives it that website&apos;s client in one go.
          </p>
          <BulkCreateForm
            proposals={proposals}
            clients={clients}
            xeroContacts={xeroContacts}
            existingWebsites={existingWebsites.map((w) => ({
              id: w.id,
              name: w.name,
              clientName: w.client?.name ?? null,
            }))}
          />
        </div>
      )}
    </>
  );
}
