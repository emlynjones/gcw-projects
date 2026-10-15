/**
 * Turning a pile of domains into websites.
 *
 * A registrar export is a flat list of domains, but a client doesn't think in
 * domains — they think in *their website*, which often owns several. Every
 * multi-domain case in the real data is the same site under a different suffix:
 * aberdashery.co.uk + aberdashery.com, arlein.cymru + arlein.wales,
 * yffarmers under four. So the grouping key is the label *below* the public
 * suffix, and the suffix only decides which domain gets to name the website.
 *
 * The one thing this must never do is merge two clients' domains because they
 * happen to share a name — hence the split rule in groupServicesIntoWebsites.
 */
import { registrableDomain, extractDomains } from "@/lib/domains";

/** The registrable domain for a service label, whether bare or embedded in free text. */
export function domainOf(label: string): string {
  return registrableDomain(label) || extractDomains(label)[0] || "";
}

/**
 * The grouping key: the label below the public suffix.
 * `aberdashery.co.uk` → `aberdashery`; `Hosting for shop.acme.com` → `acme`.
 * Returns "" when there's no domain to work with.
 */
export function siteKey(label: string): string {
  const domain = domainOf(label);
  if (!domain) return "";
  return domain.split(".")[0];
}

/** Company-form words that differ between a trading name and a registered one. */
const NAME_NOISE = /\b(ltd|limited|cyf|cyfyngedig|plc|llp|the|club|co|company)\b/g;

/**
 * A comparable key for something identified by name rather than domain — an
 * O365 subscription sold against "Ffynnon Wen Remedies" when the client is
 * recorded as "Ffynnonwen Remedies Ltd".
 *
 * Deliberately aggressive: strips company-form words and every non-alphanumeric
 * character, so spacing, punctuation and "Ltd" can't cause a miss. That makes it
 * good for *proposing* a link and unfit for applying one silently.
 */
export function nameKey(value: string): string {
  return (value ?? "").toLowerCase().replace(NAME_NOISE, " ").replace(/[^a-z0-9]/g, "");
}

/**
 * The key a service groups on: its domain if it has one, otherwise its name.
 *
 * The two forms are meant to collide. `aberdashery.co.uk` and an O365
 * subscription sold to "Aberdashery" both key to `aberdashery`, which is how a
 * licence with no domain in it finds its way to the right website.
 *
 * The em-dash split is a convention the importer creates: a licence row is
 * labelled "<customer> — <product>" because the product repeats across every
 * row and can't identify anything. Only the customer half says who it belongs
 * to, so only that half is keyed on — otherwise the product name would swamp it
 * and nothing would ever match.
 */
export function groupKey(label: string): string {
  const domain = siteKey(label);
  if (domain) return domain;
  const [identity] = (label ?? "").split(" — ");
  return nameKey(identity || label);
}

/**
 * Which suffix wins when a site holds several domains. A Welsh agency's clients
 * lead with .co.uk where they have one; .cymru/.wales pairs are a coin flip, so
 * the name stays editable before anything is written.
 */
const TLD_RANK = ["co.uk", "uk", "org.uk", "com", "org", "cymru", "wales"];

const suffixOf = (domain: string): string => domain.split(".").slice(1).join(".");

const rankOf = (domain: string): number => {
  const i = TLD_RANK.indexOf(suffixOf(domain));
  return i === -1 ? TLD_RANK.length : i;
};

/** The domain that should name the website. */
export function pickPrimaryDomain(domains: string[]): string {
  const sorted = [...domains].filter(Boolean).sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  return sorted[0] ?? "";
}

export type GroupableService = {
  id: string;
  label: string;
  clientId: string | null;
  kind?: string;
};

export type WebsiteGroup = {
  /** Stable id for form fields — key plus the client it's scoped to. */
  id: string;
  key: string;
  primaryDomain: string;
  domains: string[];
  serviceIds: string[];
  /** How many of each kind are in here — what the group actually consists of. */
  kinds: Record<string, number>;
  /** The client its services already agree on, if any. */
  clientId: string | null;
};

/**
 * Group services into proposed websites by site key.
 *
 * Services already assigned to different clients are split into separate
 * groups even when the name matches — merging them would attach one client's
 * domain to another's website and, downstream, invoice the wrong person.
 * Unassigned services join the group only when there's exactly one client in
 * play; when it's ambiguous they form their own unassigned group.
 *
 * Services with no domain group on their name instead, so a licence sold to
 * "Aberdashery" lands with the aberdashery domains rather than being stranded.
 */
export function groupServicesIntoWebsites(services: GroupableService[]): WebsiteGroup[] {
  const byKey = new Map<string, GroupableService[]>();

  for (const service of services) {
    const key = groupKey(service.label);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(service);
    else byKey.set(key, [service]);
  }

  const groups: WebsiteGroup[] = [];

  for (const [key, bucket] of byKey) {
    const clientIds = [...new Set(bucket.map((s) => s.clientId).filter(Boolean))] as string[];

    if (clientIds.length <= 1) {
      groups.push(buildGroup(key, bucket, clientIds[0] ?? null));
      continue;
    }

    // Ambiguous: one group per client, plus one for the unassigned remainder.
    for (const clientId of clientIds) {
      groups.push(buildGroup(key, bucket.filter((s) => s.clientId === clientId), clientId));
    }
    const orphans = bucket.filter((s) => !s.clientId);
    if (orphans.length) groups.push(buildGroup(key, orphans, null));
  }

  return groups.sort((a, b) => a.primaryDomain.localeCompare(b.primaryDomain));
}

function buildGroup(key: string, services: GroupableService[], clientId: string | null): WebsiteGroup {
  const domains = [...new Set(services.map((s) => domainOf(s.label)).filter(Boolean))].sort();

  // Named-only groups (an O365 licence, say) have no domain to be called after.
  // Fall back to the *identity* half of the label rather than the whole thing —
  // an imported licence reads "Bethan Davies — Microsoft 365 Business Basic
  // (NCE Annual Term)", and naming a website after the product would be absurd.
  const fallback = (services[0]?.label ?? "").split(" — ")[0].trim();
  const name = pickPrimaryDomain(domains) || fallback || key;

  const kinds: Record<string, number> = {};
  for (const s of services) {
    const k = s.kind ?? "OTHER";
    kinds[k] = (kinds[k] ?? 0) + 1;
  }

  return {
    id: `${key}#${clientId ?? "none"}`,
    key,
    primaryDomain: name,
    domains,
    serviceIds: services.map((s) => s.id),
    kinds,
    clientId,
  };
}
