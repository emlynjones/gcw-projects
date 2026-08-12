import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomToken, hashToken, verifyPkce } from "@/lib/oauth";

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function verifyClientSecret(clientId: string, clientSecret: string | undefined): Promise<boolean> {
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return false;
  if (!client.clientSecretHash) return true; // public client — no secret required
  return !!clientSecret && hashToken(clientSecret) === client.clientSecretHash;
}

function issueTokens() {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  return { accessToken, refreshToken, accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS) };
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refreshToken,
  });
}

/** OAuth 2.1 token endpoint — authorization_code (+ PKCE) and refresh_token grants. */
export async function POST(req: Request) {
  const form = await req.formData();
  const grantType = form.get("grant_type");
  const clientId = String(form.get("client_id") ?? "");
  const clientSecret = form.get("client_secret") ? String(form.get("client_secret")) : undefined;

  if (!clientId || !(await verifyClientSecret(clientId, clientSecret))) {
    return err("invalid_client", 401);
  }

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const codeVerifier = String(form.get("code_verifier") ?? "");

    const stored = await prisma.oAuthCode.findUnique({ where: { code } });
    if (!stored || stored.clientId !== clientId || stored.redirectUri !== redirectUri) return err("invalid_grant");
    if (stored.expiresAt < new Date()) {
      await prisma.oAuthCode.delete({ where: { code } });
      return err("invalid_grant");
    }
    if (!codeVerifier || !verifyPkce(codeVerifier, stored.codeChallenge)) return err("invalid_grant");

    await prisma.oAuthCode.delete({ where: { code } });

    const { accessToken, refreshToken, accessExpiresAt } = issueTokens();
    await prisma.oAuthToken.create({
      data: {
        clientId,
        userId: stored.userId,
        accessTokenHash: hashToken(accessToken),
        refreshTokenHash: hashToken(refreshToken),
        accessExpiresAt,
      },
    });
    return tokenResponse(accessToken, refreshToken);
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const existing = await prisma.oAuthToken.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } });
    if (!existing || existing.revoked || existing.clientId !== clientId) return err("invalid_grant");

    const { accessToken, refreshToken: newRefreshToken, accessExpiresAt } = issueTokens();
    await prisma.oAuthToken.update({
      where: { id: existing.id },
      data: {
        accessTokenHash: hashToken(accessToken),
        refreshTokenHash: hashToken(newRefreshToken),
        accessExpiresAt,
      },
    });
    return tokenResponse(accessToken, newRefreshToken);
  }

  return err("unsupported_grant_type");
}
