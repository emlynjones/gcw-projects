import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { authorizeUrl, xeroConfigured } from "@/lib/xero";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", process.env.AUTH_URL));
  if (!xeroConfigured()) {
    return NextResponse.redirect(new URL("/settings?xeroError=notconfigured", process.env.AUTH_URL));
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return NextResponse.redirect(authorizeUrl(state));
}
