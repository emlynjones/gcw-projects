import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591) — lets claude.ai self-register
 * instead of a human having to paste in a client id/secret.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const redirectUris = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string")) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris must be a non-empty array of strings" },
      { status: 400 }
    );
  }

  const authMethod = body?.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none";
  const clientName = typeof body?.client_name === "string" ? body.client_name : null;
  const grantTypes = ["authorization_code", "refresh_token"];
  const responseTypes = ["code"];

  const clientId = randomBytes(16).toString("hex");
  const clientSecret = authMethod === "client_secret_post" ? randomBytes(32).toString("base64url") : null;

  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash: clientSecret ? createHash("sha256").update(clientSecret).digest("hex") : null,
      clientName,
      redirectUris: JSON.stringify(redirectUris),
    },
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: grantTypes,
      response_types: responseTypes,
      ...(clientName ? { client_name: clientName } : {}),
    },
    { status: 201 }
  );
}
