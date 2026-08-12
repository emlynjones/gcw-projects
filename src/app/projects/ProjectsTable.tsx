"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { gbp, monthFmt, dateFmt, stageLabel, projectTypeLabel } from "@/lib/status";

export type ProjectRow = {
  id: string;
  title: string;
  type: string;
  stage: string;
  startDate: Date | null;
  targetDate: Date | null;
  totalValue: number;
  updatedAt: Date;
  client: { name: string };
  invoices: { amount: number }[];
};

export default function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q) || p.client.name.toLowerCase().includes(q));
  }, [projects, q]);

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects or clients…"
        className="mt"
        style={{ maxWidth: 320 }}
      />

      <table className="mt">
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Stage</th>
            <th>Dates</th>
            <th className="num">Value (ex-VAT)</th>
            <th className="num">Invoiced</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  {p.type === "ADHOC" && (
                    <span className="badge badge-type ml-1">{projectTypeLabel(p.type)}</span>
                  )}
                </td>
                <td>{p.client.name}</td>
                <td>
                  <span className={`badge ${p.stage === "LOST" ? "badge-life-LOST" : "badge-stage"}`}>
                    {stageLabel(p.stage)}
                  </span>
                </td>
                <td className="muted small">
                  {p.startDate || p.targetDate
                    ? `${p.startDate ? monthFmt(p.startDate) : "?"} → ${p.targetDate ? monthFmt(p.targetDate) : "?"}`
                    : "—"}
                </td>
                <td className="num">{gbp(p.totalValue)}</td>
                <td className="num">{gbp(invoiced)}</td>
                <td className="muted small">{dateFmt(p.updatedAt)}</td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                {q ? `No matches for "${query.trim()}".` : "Nothing here."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
