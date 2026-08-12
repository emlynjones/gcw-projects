import { randomBytes, createHash, timingSafeEqual } from "crypto";

/** MCP OAuth 2.1 helpers: token generation/hashing, PKCE (RFC 7636 S256), issuer URL. */

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issuerUrl(): string {
  const url = process.env.AUTH_URL;
  if (!url) throw new Error("AUTH_URL is required for the OAuth issuer");
  return url.replace(/\/$/, "");
}
