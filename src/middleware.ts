import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

// Protect everything except auth endpoints, the MCP API (Bearer-key auth), the MCP OAuth
// endpoints (called server-to-server, no session cookie), login, and static assets.
// /oauth/authorize deliberately stays protected — it's the login-gated consent screen.
export const config = {
  matcher: ["/((?!api/auth|api/mcp|api/oauth|\\.well-known|login|_next/static|_next/image|favicon.ico).*)"],
};
