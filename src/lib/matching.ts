/**
 * Working out which client an imported domain/hosting/O365 row belongs to.
 *
 * The strongest evidence by far is billing history: if we invoiced acme.co.uk to
 * a client last year, that domain is theirs. Everything else is a fallback,
 * because a contact email says little about domain ownership — roughly half the
 * client base uses gmail/hotmail addresses, and agencies routinely hold domains
 * for clients whose email is elsewhere.
 *
 * Every suggestion carries its evidence so the import preview can show *why*,
 * and only HIGH/MEDIUM confidence is ever auto-assigned — a wrong silent match
 * is worse than an unassigned row, because it invoices the wrong client.
 */
import { registrableDomain, extractDomains } from "@/lib/domains";
import { nameKey } from "@/lib/websites";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type BilledDomainInfo = {
  clientIds: Set<string>;
  lastAmount: number;
  lastInvoiceNumber: string | null;
  lastDateDisplay: string;
};

export type MatchContext = {
  /** registrable domain → who has been invoiced for it. */
  billed: Map<string, BilledDomainInfo>;
  websites: { id: string; clientId: string | null; name: string }[];
  devSites: { url: string; clientId: string }[];
  clients: { id: string; name: string; email: string | null }[];
};

export type Suggestion = {
  clientId: string | null;
  websiteId: string | null;
  confidence: Confidence;
  reason: string;
  /** What we last charged for this domain — seeds the sell price. */
  suggestedSellPrice: number | null;
};

/** Mailbox providers that say nothing about who owns a domain. */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "outlook.co.uk", "live.co.uk", "live.com", "yahoo.com", "yahoo.co.uk",
  "btinternet.com", "icloud.com", "me.com", "aol.com", "sky.com", "virginmedia.com",
  "talktalk.net", "tiscali.co.uk", "msn.com", "protonmail.com", "proton.me",
]);

/** Only these are safe to apply without a human looking. */
export function isAutoAssignable(c: Confidence): boolean {
  return c === "HIGH" || c === "MEDIUM";
}

const emailDomain = (email: string | null): string => {
  if (!email || !email.includes("@")) return "";
  const d = registrableDomain(email.split("@").pop() ?? "");
  return GENERIC_EMAIL_DOMAINS.has(d) ? "" : d;
};

/** Words in a name that carry no identifying signal. */
const STOP_WORDS = new Set([
  "ltd", "limited", "plc", "llp", "cyf", "the", "and", "co", "company", "group",
  "services", "solutions", "uk", "wales", "cymru", "council", "community",
]);

const nameTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

/**
 * Attribution for a row identified only by name — an Office 365 subscription
 * sold against "Ffynnon Wen Remedies" with no domain anywhere in it.
 *
 * Two places to look, and the second matters more than it sounds: the customer
 * name on a supplier's licence is often the *trading* name, which matches a
 * website rather than the client record. "DSSBH" is no client of that name, but
 * it's the website dssbh.co.uk, which belongs to DS Small Business Help Ltd.
 *
 * Everything here stays LOW. A squashed-name match is good evidence for showing
 * someone a suggestion and poor grounds for assigning billing on its own, and
 * only HIGH/MEDIUM is ever applied without a human.
 */
function byName(label: string, ctx: MatchContext): Suggestion {
  const key = nameKey(label);
  const none: Suggestion = {
    clientId: null,
    websiteId: null,
    confidence: "NONE",
    reason: "No match — assign manually",
    suggestedSellPrice: null,
  };
  if (key.length < 4) return none;

  const clients = ctx.clients.filter((c) => nameKey(c.name) === key);
  if (clients.length === 1) {
    const site = ctx.websites.find((w) => w.clientId === clients[0].id && nameKey(w.name) === key);
    return {
      clientId: clients[0].id,
      websiteId: site?.id ?? null,
      confidence: "LOW",
      reason: `Name matches client "${clients[0].name}"`,
      suggestedSellPrice: null,
    };
  }

  const sites = ctx.websites.filter((w) => nameKey(w.name) === key && w.clientId);
  if (sites.length === 1) {
    return {
      clientId: sites[0].clientId,
      websiteId: sites[0].id,
      confidence: "LOW",
      reason: `Name matches website ${sites[0].name}`,
      suggestedSellPrice: null,
    };
  }

  if (clients.length > 1 || sites.length > 1) {
    return { ...none, reason: "Name matches more than one client — pick one" };
  }
  return none;
}

/**
 * Suggest a client (and website) for an imported row, given its label.
 * `label` is whatever identifies the row — a domain for DOMAIN rows, often a
 * domain-bearing plan/account name for HOSTING and O365.
 */
export function suggestMatch(label: string, ctx: MatchContext): Suggestion {
  const none: Suggestion = {
    clientId: null,
    websiteId: null,
    confidence: "NONE",
    reason: "No match — assign manually",
    suggestedSellPrice: null,
  };

  // Domain rows carry a bare domain; hosting/O365 rows usually carry free text
  // with the domain embedded ("Hosting for shop.acme.co.uk", "Business Std (acme.co.uk)").
  const domain = registrableDomain(label) || extractDomains(label)[0] || "";
  if (!domain) return byName(label, ctx);

  const websiteFor = (clientId: string | null): string | null => {
    if (!clientId) return null;
    const site = ctx.websites.find(
      (w) => w.clientId === clientId && registrableDomain(w.name) === domain
    );
    return site?.id ?? null;
  };

  /* 1 — billing history: the ground truth. */
  const billed = ctx.billed.get(domain);
  if (billed && billed.clientIds.size === 1) {
    const clientId = [...billed.clientIds][0];
    const ref = billed.lastInvoiceNumber ? `invoice #${billed.lastInvoiceNumber}` : "a past invoice";
    return {
      clientId,
      websiteId: websiteFor(clientId),
      confidence: "HIGH",
      reason: `Billed on ${ref} (${billed.lastDateDisplay})`,
      suggestedSellPrice: billed.lastAmount || null,
    };
  }
  if (billed && billed.clientIds.size > 1) {
    // Billed to more than one client — genuinely ambiguous, don't guess.
    return {
      ...none,
      confidence: "LOW",
      reason: `Billed to ${billed.clientIds.size} different clients — pick one`,
      suggestedSellPrice: billed.lastAmount || null,
    };
  }

  /* 2 — an existing website record. */
  const site = ctx.websites.find((w) => registrableDomain(w.name) === domain && w.clientId);
  if (site) {
    return {
      clientId: site.clientId,
      websiteId: site.id,
      confidence: "HIGH",
      reason: `Matches existing website ${site.name}`,
      suggestedSellPrice: null,
    };
  }

  /* 3 — a dev/staging URL recorded against a project. */
  const dev = ctx.devSites.find((d) => registrableDomain(d.url) === domain);
  if (dev) {
    return {
      clientId: dev.clientId,
      websiteId: websiteFor(dev.clientId),
      confidence: "MEDIUM",
      reason: `Matches a project dev site (${dev.url})`,
      suggestedSellPrice: null,
    };
  }

  /* 4 — client's own-domain email. Fallback: suggestion only. */
  const byEmail = ctx.clients.filter((c) => emailDomain(c.email) === domain);
  if (byEmail.length === 1) {
    return {
      clientId: byEmail[0].id,
      websiteId: websiteFor(byEmail[0].id),
      confidence: "LOW",
      reason: `Client email is @${domain}`,
      suggestedSellPrice: null,
    };
  }

  /* 5 — fuzzy name overlap. Weakest; never auto-assigned. */
  const domainWord = domain.split(".")[0];
  const domainTokens = nameTokens(domainWord.replace(/[^a-z0-9]/gi, " "));
  const compact = domainWord.replace(/[^a-z0-9]/gi, "").toLowerCase();

  let best: { client: { id: string; name: string }; score: number } | null = null;
  for (const client of ctx.clients) {
    const tokens = nameTokens(client.name);
    if (!tokens.length) continue;

    const compactName = tokens.join("");
    let score = 0;
    if (compactName === compact) score = 3;
    else if (compact.length > 4 && (compactName.includes(compact) || compact.includes(compactName)))
      score = 2;
    else score = tokens.filter((t) => domainTokens.includes(t) || compact.includes(t)).length;

    if (score > 0 && (!best || score > best.score)) best = { client, score };
  }

  if (best && best.score >= 2) {
    return {
      clientId: best.client.id,
      websiteId: websiteFor(best.client.id),
      confidence: "LOW",
      reason: `Name looks like "${best.client.name}"`,
      suggestedSellPrice: null,
    };
  }

  return none;
}
