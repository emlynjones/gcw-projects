import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";
import { registrableDomain } from "@/lib/domains";
import BilledTable, { type BilledDomainRow } from "./BilledTable";

export const dynamic = "force-dynamic";

/**
 * Every domain that has ever appeared on a Xero invoice line, and who it was
 * billed to. Built purely from the cached invoice lines, so it's the evidence
 * base behind import matching — and on its own it answers "what am I already
 * charging for, and what am I not tracking?".
 */
export default async function BilledDomainsPage() {
  const lines = await prisma.xeroInvoiceLine.findMany({
    where: { domains: { not: null } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { invoiceDate: "desc" },
  });

  const tracked = new Set(
    (await prisma.recurringService.findMany({ select: { label: true } }))
      .map((s) => registrableDomain(s.label))
      .filter(Boolean)
  );

  // Group lines by domain; the first seen is the most recent (query is date DESC).
  type Acc = {
    domain: string;
    clientIds: Set<string>;
    clientId: string | null;
    clientName: string | null;
    lastDate: Date;
    lastAmount: number;
    lastDescription: string;
    lastInvoiceNumber: string | null;
    lastInvoiceId: string | null;
    timesBilled: number;
  };
  const byDomain = new Map<string, Acc>();

  for (const line of lines) {
    let domains: string[] = [];
    try {
      domains = JSON.parse(line.domains!) as string[];
    } catch {
      continue;
    }
    for (const domain of domains) {
      const existing = byDomain.get(domain);
      if (existing) {
        existing.timesBilled++;
        if (line.clientId) existing.clientIds.add(line.clientId);
        continue;
      }
      byDomain.set(domain, {
        domain,
        clientIds: new Set(line.clientId ? [line.clientId] : []),
        clientId: line.client?.id ?? null,
        clientName: line.client?.name ?? null,
        lastDate: line.invoiceDate,
        lastAmount: line.lineAmount,
        lastDescription: line.description,
        lastInvoiceNumber: line.xeroNumber,
        lastInvoiceId: line.xeroInvoiceId,
        timesBilled: 1,
      });
    }
  }

  const rows: BilledDomainRow[] = [...byDomain.values()]
    .sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime())
    .map((a) => ({
      domain: a.domain,
      clientId: a.clientId,
      clientName: a.clientName,
      contested: a.clientIds.size > 1,
      lastBilledDisplay: dateFmt(a.lastDate),
      lastAmount: a.lastAmount,
      timesBilled: a.timesBilled,
      lastDescription: a.lastDescription,
      lastInvoiceNumber: a.lastInvoiceNumber,
      lastInvoiceId: a.lastInvoiceId,
      tracked: tracked.has(a.domain),
    }));

  return (
    <>
      <div className="page-head">
        <h1>Billed domains</h1>
        <Link href="/recurring" className="btn btn-secondary">
          Recurring services
        </Link>
      </div>

      <p className="muted small">
        Domains found in your Xero invoice line descriptions over the last 3 years. Anything marked{" "}
        <strong>Not tracked</strong> is being billed but isn&apos;t recorded as a recurring service —
        so nothing will remind you to bill it next year.
      </p>

      {rows.length === 0 ? (
        <div className="card mt">
          <p className="muted">
            No invoice history scanned yet. Run <strong>Scan invoice history</strong> from{" "}
            <Link href="/settings">Settings</Link>.
          </p>
        </div>
      ) : (
        <BilledTable rows={rows} />
      )}
    </>
  );
}
