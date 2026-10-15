import { prisma } from "@/lib/prisma";
import { dateFmt } from "@/lib/status";
import type { MatchContext, BilledDomainInfo } from "@/lib/matching";

/**
 * Build the evidence base for matching a domain to a client: billed domains
 * from the cached Xero invoice lines, plus existing websites, dev sites and
 * clients.
 *
 * Shared by the CSV import and the bulk website builder so both attribute
 * domains the same way — and so the reason shown to the user is the same reason
 * either flow acted on.
 */
export async function buildMatchContext(): Promise<MatchContext> {
  const [lines, websites, devSites, clients] = await Promise.all([
    prisma.xeroInvoiceLine.findMany({
      where: { domains: { not: null }, clientId: { not: null } },
      orderBy: { invoiceDate: "desc" },
      select: {
        clientId: true,
        domains: true,
        lineAmount: true,
        xeroNumber: true,
        invoiceDate: true,
      },
    }),
    prisma.website.findMany({ select: { id: true, clientId: true, name: true } }),
    prisma.devSite.findMany({ select: { url: true, project: { select: { clientId: true } } } }),
    prisma.client.findMany({ select: { id: true, name: true, email: true } }),
  ]);

  const billed = new Map<string, BilledDomainInfo>();
  for (const line of lines) {
    let domains: string[] = [];
    try {
      domains = JSON.parse(line.domains!) as string[];
    } catch {
      continue;
    }
    for (const domain of domains) {
      const existing = billed.get(domain);
      if (existing) {
        existing.clientIds.add(line.clientId!);
        continue;
      }
      // Lines are date-DESC, so the first seen is the most recent.
      billed.set(domain, {
        clientIds: new Set([line.clientId!]),
        lastAmount: line.lineAmount,
        lastInvoiceNumber: line.xeroNumber,
        lastDateDisplay: dateFmt(line.invoiceDate),
      });
    }
  }

  return {
    billed,
    websites,
    devSites: devSites
      .filter((d) => d.project?.clientId)
      .map((d) => ({ url: d.url, clientId: d.project!.clientId })),
    clients,
  };
}
