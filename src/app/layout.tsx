import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import GlobalSearch from "@/app/components/GlobalSearch";
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
                <div className="nav-group">
                  <Link href="/projects">Work</Link>
                  <div className="nav-menu">
                    <Link href="/work">My Work</Link>
                    <Link href="/work?view=all">All Work</Link>
                    <Link href="/work?view=planner">Weekly Planner</Link>
                    <Link href="/work?view=kanban">Kanban</Link>
                    <Link href="/work/processes">Process Library</Link>
                    <Link href="/projects?type=PROJECT">Projects</Link>
                    <Link href="/projects?type=ADHOC">Ad-hoc</Link>
                  </div>
                </div>
                <Link href="/clients">Clients</Link>
                <Link href="/websites">Websites</Link>
                <div className="nav-group">
                  <Link href="/recurring/dashboard">Recurring</Link>
                  <div className="nav-menu">
                    <Link href="/recurring/dashboard">Overview</Link>
                    <Link href="/recurring/microsoft-365">Microsoft 365</Link>
                    <Link href="/recurring/careplans">Care plans</Link>
                    <Link href="/recurring">All services</Link>
                  </div>
                </div>
                <Link href="/reports">Reports</Link>
                <Link href="/settings">Settings</Link>
              </nav>
              <GlobalSearch />
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
