import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

// Protect everything except auth endpoints, the MCP API (Bearer-key auth), login, and static assets.
export const config = {
  matcher: ["/((?!api/auth|api/mcp|login|_next/static|_next/image|favicon.ico).*)"],
};
