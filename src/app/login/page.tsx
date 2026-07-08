import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function loginMicrosoft() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }

  async function loginAdmin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=1");
      throw e; // rethrow NEXT_REDIRECT
    }
  }

  return (
    <div className="login-wrap">
      <div className="card">
        <div className="login-title">
          <div className="brand-lg">
            <span>GWE</span> Cambrian <span>WEB</span>
          </div>
          <div className="muted small" style={{ marginTop: 2, fontWeight: 600 }}>
            Projects
          </div>
          <div className="muted small">Gwe Cambrian Web — project pipeline</div>
        </div>

        {error && <div className="error-msg">Sign in failed. Check your details and try again.</div>}

        <form action={loginMicrosoft}>
          <button type="submit" className="btn btn-block">
            Sign in with Microsoft
          </button>
        </form>

        <div className="divider">or admin login</div>

        <form action={loginAdmin} className="stack">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn btn-secondary btn-block">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
