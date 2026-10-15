/**
 * Domain normalisation + extraction.
 *
 * The registrable domain (acme.co.uk, not www.acme.co.uk/shop) is the join key
 * that ties a supplier's CSV row to a client: it appears in domain registrar
 * exports, in hosting account names, and — crucially — in the free text of the
 * Xero invoice lines we've already billed. Getting it consistent is what makes
 * matching work.
 *
 * We hardcode the UK multi-part suffixes rather than pull in the full public
 * suffix list: this is a Welsh web agency, so .co.uk/.org.uk/.wales/.cymru
 * cover essentially everything, and a 2KB dependency-free list beats a 200KB one.
 */

/** Second-level suffixes where the registrable domain is the *third* label. */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "net.uk",
  "sch.uk",
  "ac.uk",
  "gov.uk",
  "nhs.uk",
  "police.uk",
  "mod.uk",
  "com.au",
  "co.nz",
  "co.za",
  "com.br",
]);

/** Lowercase, strip scheme / www. / path / port / trailing dot. */
export function normalizeDomain(input: string): string {
  let s = (input ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.replace(/^[^/@]*@/, ""); // userinfo or an email local-part
  s = s.split(/[/?#]/)[0]; // path/query/fragment
  s = s.split(":")[0]; // port
  s = s.replace(/\.+$/, ""); // trailing dot(s)
  s = s.replace(/^www\./, "");
  return s;
}

/**
 * The registrable domain — one label above the public suffix.
 * `shop.acme.co.uk` → `acme.co.uk`; `mail.acme.com` → `acme.com`.
 * Returns "" when the input isn't domain-shaped.
 */
export function registrableDomain(input: string): string {
  const host = normalizeDomain(input);
  if (!host || !host.includes(".")) return "";
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)) return "";

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return "";

  const lastTwo = parts.slice(-2).join(".");
  const wanted = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (parts.length < wanted) return "";
  return parts.slice(-wanted).join(".");
}

/**
 * TLDs we accept when scraping free text. Deliberately a allowlist: invoice
 * descriptions are full of things that look domain-ish but aren't
 * ("Ltd.Company", "v1.2", "Mon.Fri", prices like "1.50").
 */
const KNOWN_TLDS = new Set([
  "uk", "com", "net", "org", "co", "io", "ai", "app", "dev", "info", "biz",
  "wales", "cymru", "scot", "london", "eu", "de", "fr", "es", "it", "nl", "ie",
  "us", "ca", "au", "nz", "za", "br", "shop", "store", "online", "site", "website",
  "agency", "studio", "design", "group", "solutions", "services", "digital",
  "media", "photography", "cafe", "pub", "bar", "church", "school", "academy",
  "clinic", "vet", "law", "legal", "properties", "homes", "life", "live", "world",
  "email", "cloud", "host", "tech", "systems", "network", "works", "team", "today",
]);

/** Tokens that look like domains but never are. */
const NOISE = new Set(["e.g", "i.e", "etc.co", "no.uk"]);

/**
 * Pull every registrable domain out of a blob of free text — used on Xero
 * invoice line descriptions and references to work out what a client has
 * already been billed for.
 */
export function extractDomains(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();

  // Domain-shaped runs: label(.label)+ with a 2+ char final label.
  const re = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1].toLowerCase();
    if (NOISE.has(raw)) continue;

    const parts = raw.split(".");
    const tld = parts[parts.length - 1];
    if (!KNOWN_TLDS.has(tld)) continue;
    // A bare TLD-looking pair with a 1-char name ("a.uk") is almost certainly noise.
    if (parts[parts.length - 2] && parts[parts.length - 2].length < 2) continue;

    const reg = registrableDomain(raw);
    if (reg) found.add(reg);
  }
  return [...found];
}

/** Do two labels refer to the same registrable domain? */
export function sameDomain(a: string, b: string): boolean {
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  return !!ra && ra === rb;
}
