"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/work", label: "My Work" },
  { href: "/projects", label: "Projects" },
  { href: "/clients", label: "Clients" },
  { href: "/websites", label: "Websites" },
  { href: "/invoices/run", label: "Billing", also: ["/recurring", "/invoices"] },
  { href: "/reports", label: "Reports" },
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {links.map(({ href, label, exact, also = [] }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`) || also.some((root) => pathname.startsWith(root));
        return <Link key={href} href={href} className={active ? "active" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
