import { NextResponse } from "next/server";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { issuerUrl } from "@/lib/oauth";

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export function GET() {
  const issuer = issuerUrl();
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
