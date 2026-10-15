"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type ClientRow = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  isInternal: boolean;
  _count: { projects: number; websites: number };
};

/**
 * A count is only worth clicking when there's something behind it — a linked
 * zero just leads to an empty list.
 */
function CountLink({ n, href, label }: { n: number; href: string; label: string }) {
  if (n === 0) return <span className="muted">0</span>;
  return (
    <Link href={href} title={label}>
      {n}
    </Link>
  );
}

export default function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.contactName?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
    );
  }, [clients, q]);

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clients…"
        className="mt"
        style={{ maxWidth: 320 }}
      />

      <table className="mt">
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>Email</th>
            <th>Phone</th>
            <th className="num">Projects</th>
            <th className="num">Websites</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/clients/${c.id}`}>{c.name}</Link>
                {c.isInternal && <span className="badge ml-1">us · not invoiced</span>}
              </td>
              <td>{c.contactName ?? "—"}</td>
              <td>{c.email ?? "—"}</td>
              <td>{c.phone ?? "—"}</td>
              <td className="num">
                <CountLink
                  n={c._count.projects}
                  href={`/projects?client=${c.id}`}
                  label={`Projects for ${c.name}`}
                />
              </td>
              <td className="num">
                <CountLink
                  n={c._count.websites}
                  href={`/websites?client=${c.id}`}
                  label={`Websites for ${c.name}`}
                />
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                {q ? `No matches for "${query.trim()}".` : "No clients yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
