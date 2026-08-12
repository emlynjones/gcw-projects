import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="login-wrap">
      <div className="card">
        <h2>Authorization error</h2>
        <p className="error-msg">{message}</p>
      </div>
    </div>
  );
}

/** OAuth 2.1 authorization endpoint (RFC 6749 + PKCE) — consent screen for the MCP OAuth flow. */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const {
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
  } = params;

  if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge) {
    return <ErrorCard message="Invalid authorization request — missing required parameters." />;
  }
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return <ErrorCard message="Only the S256 PKCE method is supported." />;
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return <ErrorCard message="Unknown client." />;

  const redirectUris: string[] = JSON.parse(client.redirectUris);
  if (!redirectUris.includes(redirectUri)) {
    return <ErrorCard message="redirect_uri does not match the registered client." />;
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return <ErrorCard message="Not signed in." />;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return <ErrorCard message="User not found." />;

  async function approve() {
    "use server";
    const code = randomBytes(32).toString("base64url");
    await prisma.oAuthCode.create({
      data: {
        code,
        clientId: clientId!,
        redirectUri: redirectUri!,
        codeChallenge: codeChallenge!,
        codeChallengeMethod: codeChallengeMethod || "S256",
        userId: user!.id,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const url = new URL(redirectUri!);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }

  async function deny() {
    "use server";
    const url = new URL(redirectUri!);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  }

  return (
    <div className="login-wrap">
      <div className="card">
        <div className="login-title">
          <div className="brand-lg">
            <span>GWE</span> Cambrian <span>WEB</span>
          </div>
          <div className="muted small">Projects</div>
        </div>
        <p>
          <strong>{client.clientName || "An application"}</strong> wants to access your GCW Projects
          data as <strong>{user.name}</strong>.
        </p>
        <p className="muted small">
          It will be able to read and manage clients, projects, invoices and notes via the MCP tools.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <form action={approve}>
            <button type="submit" className="btn">
              Approve
            </button>
          </form>
          <form action={deny}>
            <button type="submit" className="btn btn-danger">
              Deny
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
