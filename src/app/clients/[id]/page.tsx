import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateClient, deleteClient } from "@/app/actions";
import { gbp, stageLabel, dateFmt, projectTypeLabel } from "@/lib/status";
import { serviceKindLabel } from "@/lib/recurring";
import RecurringServices from "./RecurringServices";
import ClientInvoices, { type ClientInvoice } from "./ClientInvoices";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      projects: { include: { invoices: true }, orderBy: { updatedAt: "desc" } },
      websites: { orderBy: { name: "asc" } },
      recurringServices: {
        include: { billings: true, _count: { select: { invoiceLines: true } } },
        orderBy: [{ kind: "asc" }, { label: "asc" }],
      },
    },
  });
  if (!client) notFound();

  const catalogue = await prisma.service.findMany({
    where: { active: true, unit: { in: ["month", "year"] } },
    select: { id: true, name: true, price: true, unit: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  // Invoice history, grouped back into invoices. Lines are the unit everywhere
  // else in the system, but a person reads their own ledger as invoices.
  const rawLines = await prisma.xeroInvoiceLine.findMany({
    where: { clientId: client.id },
    orderBy: [{ invoiceDate: "desc" }, { lineIndex: "asc" }],
    select: {
      id: true,
      xeroInvoiceId: true,
      xeroNumber: true,
      lineIndex: true,
      invoiceDate: true,
      status: true,
      description: true,
      quantity: true,
      lineAmount: true,
      service: { select: { label: true, kind: true } },
    },
  });

  const invoiceMap = new Map<string, ClientInvoice>();
  for (const l of rawLines) {
    let inv = invoiceMap.get(l.xeroInvoiceId);
    if (!inv) {
      inv = {
        xeroInvoiceId: l.xeroInvoiceId,
        xeroNumber: l.xeroNumber,
        invoiceDate: l.invoiceDate,
        status: l.status,
        total: 0,
        lines: [],
      };
      invoiceMap.set(l.xeroInvoiceId, inv);
    }
    inv.total += l.lineAmount;
    inv.lines.push({
      id: l.id,
      lineIndex: l.lineIndex,
      description: l.description,
      quantity: l.quantity,
      lineAmount: l.lineAmount,
      serviceLabel: l.service?.label ?? null,
      serviceKind: l.service ? serviceKindLabel(l.service.kind) : null,
    });
  }
  const invoices = [...invoiceMap.values()];

  const invoiced = invoices.reduce((n, i) => n + i.total, 0);
  const linkedLines = rawLines.filter((l) => l.service).length;
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const lastYear = invoices.filter((i) => i.invoiceDate >= yearAgo);
  const lastYearValue = lastYear.reduce((n, i) => n + i.total, 0);
  const firstInvoice = invoices.length ? invoices[invoices.length - 1].invoiceDate : null;

  return (
    <>
      <div className="page-head">
        <h1>{client.name}</h1>
        <Link href="/projects/new" className="btn btn-secondary">
          + New project
        </Link>
      </div>

      <div className="card">
        <h2>Details</h2>
        <form action={updateClient.bind(null, client.id)} className="stack">
          <div className="field">
            <label htmlFor="name">Company / organisation name</label>
            <input id="name" name="name" defaultValue={client.name} required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="contactName">Contact name</label>
              <input id="contactName" name="contactName" defaultValue={client.contactName ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" defaultValue={client.email ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={client.phone ?? ""} />
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" name="isInternal" defaultChecked={client.isInternal} />{" "}
            <span><strong>This client is us</strong><small>Track its websites and services, but never invoice them.</small></span>
          </label>
          <div>
            <button type="submit" className="btn">
              Save changes
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Projects</h2>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Stage</th>
              <th className="num">Value (ex-VAT)</th>
              <th className="num">Invoiced</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {client.projects.map((p) => {
              const invoiced = p.invoices.reduce((s, i) => s + i.amount, 0);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.title}</Link>
                    {p.type === "ADHOC" && (
                      <span className="badge badge-type ml-1">{projectTypeLabel(p.type)}</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-stage">{stageLabel(p.stage)}</span>
                  </td>
                  <td className="num">{gbp(p.totalValue)}</td>
                  <td className="num">{gbp(invoiced)}</td>
                  <td className="muted small">{dateFmt(p.updatedAt)}</td>
                </tr>
              );
            })}
            {client.projects.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No projects for this client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RecurringServices
        clientId={client.id}
        clientInternal={client.isInternal}
        websites={client.websites}
        services={client.recurringServices}
        catalogue={catalogue}
      />

      <div className="card">
        <h2>Invoice history</h2>
        <div className="stats">
          <div>
            <div className="label">Invoiced ever</div>
            <div className="value">{gbp(invoiced)}</div>
            <div className="muted">
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
              {firstInvoice && <> since {dateFmt(firstInvoice)}</>}
            </div>
          </div>
          <div>
            <div className="label">Last 12 months</div>
            <div className="value">{gbp(lastYearValue)}</div>
            <div className="muted">
              {lastYear.length} invoice{lastYear.length === 1 ? "" : "s"}
            </div>
          </div>
          <div>
            <div className="label">Lines</div>
            <div className="value">{rawLines.length}</div>
            <div className="muted">{linkedLines} linked to a service</div>
          </div>
          <div>
            <div className="label">Recurring services</div>
            <div className="value">{client.recurringServices.length}</div>
            <div className="muted">
              {client.recurringServices.filter((s) => s.sellPrice === 0).length} with no sell price
            </div>
          </div>
        </div>
        <ClientInvoices invoices={invoices} />
      </div>

      {client.projects.length === 0 && (
        <div className="card">
          <h2>Danger zone</h2>
          <form action={deleteClient.bind(null, client.id)}>
            <button type="submit" className="btn btn-danger">
              Delete client
            </button>
          </form>
        </div>
      )}
    </>
  );
}
