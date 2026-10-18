import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import GlobalSearch from "@/app/components/GlobalSearch";
import AppNav from "@/app/components/AppNav";
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
          <aside className="sidebar">
            <div className="sidebar-inner">
              <Link href="/" className="brand">
                GCW Projects
              </Link>
              <AppNav />
              <div className="sidebar-footer">
                <GlobalSearch />
                <Link href="/settings" className="sidebar-settings">Settings</Link>
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
            </div>
          </aside>
        )}
        <main className={`container${session?.user ? " app-content" : ""}`}>{children}</main>
      </body>
    </html>
  );
}
