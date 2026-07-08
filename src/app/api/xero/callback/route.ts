import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { completeConnection } from "@/lib/xero";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", process.env.AUTH_URL));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("xero_oauth_state")?.value;
  jar.delete("xero_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/settings?xeroError=state", process.env.AUTH_URL));
  }

  try {
    await completeConnection(code);
  } catch (e) {
    console.error("Xero connection failed:", e);
    return NextResponse.redirect(new URL("/settings?xeroError=token", process.env.AUTH_URL));
  }
  return NextResponse.redirect(new URL("/settings?xeroConnected=1", process.env.AUTH_URL));
}
