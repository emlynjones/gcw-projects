"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Item = { href: string; label: string; exact?: boolean };
type Group = { label: string; roots: string[]; items: Item[] };

const groups: Group[] = [
  { label: "Work", roots: ["/work"], items: [
    { href: "/work", label: "My Work", exact: true },
    { href: "/work?view=all", label: "All Work" },
    { href: "/work?view=planner", label: "Weekly Planner" },
    { href: "/work?view=kanban", label: "Kanban" },
    { href: "/work/processes", label: "Process Library" },
  ]},
  { label: "Projects", roots: ["/projects"], items: [
    { href: "/projects", label: "Current work", exact: true },
    { href: "/projects?type=PROJECT", label: "Projects" },
    { href: "/projects?type=ADHOC", label: "Ad-hoc work" },
    { href: "/projects/new?type=PROJECT", label: "New project" },
    { href: "/projects/new?type=ADHOC", label: "New ad-hoc job" },
    { href: "/projects/bulk", label: "Bulk add / edit" },
  ]},
  { label: "Clients", roots: ["/clients"], items: [
    { href: "/clients", label: "All clients", exact: true },
    { href: "/clients/new", label: "New client" },
    { href: "/clients/xero-import", label: "Import from Xero" },
  ]},
  { label: "Websites", roots: ["/websites"], items: [
    { href: "/websites", label: "All websites", exact: true },
    { href: "/websites/new", label: "New website" },
    { href: "/websites/bulk", label: "Create from domains" },
  ]},
  { label: "Billing", roots: ["/invoices", "/recurring"], items: [
    { href: "/invoices/run", label: "Billing run" },
    { href: "/recurring/dashboard", label: "Recurring overview" },
    { href: "/recurring", label: "All recurring services", exact: true },
    { href: "/invoices/review", label: "Review invoice matches" },
    { href: "/invoices/link-scan", label: "Suggested links" },
    { href: "/recurring/careplans", label: "Care plans" },
    { href: "/recurring/microsoft-365", label: "Microsoft 365" },
    { href: "/invoices/import", label: "Import invoice history" },
    { href: "/recurring/import", label: "Import recurring services" },
  ]},
  { label: "Reports", roots: ["/reports"], items: [
    { href: "/reports", label: "Weekly report", exact: true },
    { href: "/reports/recurring", label: "Not yet billed" },
  ]},
];

export default function AppNav() {
  const pathname = usePathname();
  const query = useSearchParams();
  const current = `${pathname}${query.size ? `?${query.toString()}` : ""}`;
  const itemActive = (item: Item) => item.exact
    ? current === item.href
    : current === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <Link href="/" className={pathname === "/" ? "active" : undefined}>Dashboard</Link>
      {groups.map((group) => {
        const active = group.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
        return (
          <details className="app-nav-group" key={group.label} open={active}>
            <summary className={active ? "active" : undefined}>{group.label}</summary>
            <div className="app-subnav">
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className={itemActive(item) ? "active" : undefined}>{item.label}</Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
