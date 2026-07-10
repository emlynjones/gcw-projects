import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "GCW Projects",
  description: "Gwe Cambrian Web — project pipeline",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&family=Quicksand:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {session?.user && (
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                GCW <span>Projects</span>
              </Link>
              <nav>
                <Link href="/">Dashboard</Link>
                <Link href="/projects">Projects</Link>
                <Link href="/clients">Clients</Link>
                <Link href="/reports">Reports</Link>
                <Link href="/settings">Settings</Link>
              </nav>
              <div className="topbar-user">
                <span>{session.user.name ?? session.user.email}</span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
        )}
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
