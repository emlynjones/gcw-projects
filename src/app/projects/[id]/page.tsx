import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  updateProject,
  deleteProject,
  addInvoice,
  toggleInvoicePaid,
  deleteInvoice,
  setInvoiceKind,
  addNote,
  deleteNote,
  addAttachment,
  deleteAttachment,
} from "@/app/actions";
import {
  STATUSES,
  statusLabel,
  gbp,
  dateFmt,
  PROJECT_TYPES,
  projectTypeLabel,
  INVOICE_KINDS,
  invoiceKindLabel,
} from "@/lib/status";
import { getConnection, getContactInvoices, type XeroInvoice } from "@/lib/xero";
import {
  createXeroInvoice,
  raiseDepositInvoice,
  linkInvoiceToXero,
  unlinkInvoiceFromXero,
  syncProjectInvoices,
} from "@/app/xero-actions";
import InvoiceBuilder from "./InvoiceBuilder";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ xero?: string }>;
}) {
  const { id } = await params;
  const { xero: showXeroLinking } = await searchParams;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      invoices: { orderBy: { date: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) notFound();

  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  const invoiced = project.invoices.reduce((s, i) => s + i.amount, 0);
  const left = project.totalValue - invoiced;

  const isWebsite = project.type === "WEBSITE";
  const depositAmount = Math.round(project.totalValue * (project.depositPct / 100) * 100) / 100;
  const hasDeposit = project.invoices.some((i) => i.kind === "DEPOSIT");

  // Xero context — services list for the invoice builder; contact invoices only
  // when linking mode is toggled (keeps the page fast, avoids needless API calls)
  const xeroConn = await getConnection();
  const services = xeroConn
    ? await prisma.service.findMany({
        where: { active: true },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
        select: { id: true, name: true, price: true, unit: true, category: true },
      })
    : [];
  let xeroContactInvoices: XeroInvoice[] = [];
  let xeroFetchError: string | null = null;
  if (xeroConn && showXeroLinking && project.client.xeroContactId) {
    try {
      const alreadyLinked = new Set(project.invoices.map((i) => i.xeroInvoiceId).filter(Boolean));
      xeroContactInvoices = (await getContactInvoices(project.client.xeroContactId)).filter(
        (xi) => !alreadyLinked.has(xi.InvoiceID)
      );
    } catch (e) {
      xeroFetchError = e instanceof Error ? e.message : "Xero fetch failed";
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{project.title}</h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge badge-type">{projectTypeLabel(project.type)}</span>
          <span className={`badge badge-${project.status}`}>{statusLabel(project.status)}</span>
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Total (ex-VAT)</div>
          <div className="value">{gbp(project.totalValue)}</div>
        </div>
        <div className="stat">
          <div className="label">Invoiced</div>
          <div className="value">{gbp(invoiced)}</div>
        </div>
        <div className="stat">
          <div className="label">Left to invoice</div>
          <div className="value">{gbp(left)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Details</h2>
        <form action={updateProject.bind(null, project.id)} className="stack">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={project.title} required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="clientId">Client</label>
              <select id="clientId" name="clientId" defaultValue={project.clientId}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue={project.type}>
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {projectTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={project.status}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="totalValue">Total value £ (ex-VAT)</label>
              <input
                id="totalValue"
                name="totalValue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={project.totalValue}
              />
            </div>
            <div className="field">
              <label htmlFor="depositPct">Deposit %</label>
              <input
                id="depositPct"
                name="depositPct"
                type="number"
                step="1"
                min="0"
                max="100"
                defaultValue={project.depositPct}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="proposalUrl">Proposal URL</label>
            <input
              id="proposalUrl"
              name="proposalUrl"
              type="url"
              defaultValue={project.proposalUrl ?? ""}
              placeholder="https://…"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn">
              Save changes
            </button>
            {project.proposalUrl && (
              <a href={project.proposalUrl} target="_blank" className="btn btn-secondary">
                Open proposal
              </a>
            )}
          </div>
        </form>
        <p className="muted small mt">
          Client contact: {project.client.contactName ?? "—"}
          {project.client.email ? ` · ${project.client.email}` : ""}
          {project.client.phone ? ` · ${project.client.phone}` : ""} ·{" "}
          <Link href={`/clients/${project.clientId}`}>view client</Link>
        </p>
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          {xeroConn && (
            <div style={{ display: "flex", gap: 8 }}>
              <form action={syncProjectInvoices.bind(null, project.id)}>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Sync from Xero
                </button>
              </form>
              {project.client.xeroContactId &&
                (showXeroLinking ? (
                  <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
                    Hide Xero linking
                  </Link>
                ) : (
                  <Link href={`/projects/${project.id}?xero=1`} className="btn btn-secondary btn-sm">
                    Link to Xero invoices
                  </Link>
                ))}
            </div>
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Role</th>
              <th>Date</th>
              <th className="num">Amount (ex-VAT)</th>
              <th>Xero</th>
              <th>Paid</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {project.invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.reference}</td>
                <td>
                  <form
                    action={setInvoiceKind.bind(null, inv.id, project.id)}
                    className="inline-form"
                    style={{ gap: 4 }}
                  >
                    <select name="kind" defaultValue={inv.kind ?? ""} style={{ maxWidth: 110 }}>
                      <option value="">— none —</option>
                      {INVOICE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {invoiceKindLabel(k)}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn btn-ghost btn-sm" title="Set role">
                      ✓
                    </button>
                  </form>
                </td>
                <td>{dateFmt(inv.date)}</td>
                <td className="num">{gbp(inv.amount)}</td>
                <td>
                  {inv.xeroInvoiceId ? (
                    <span className={`badge badge-xero-${inv.xeroStatus ?? "DRAFT"}`}>
                      {inv.xeroNumber ?? "Xero"} · {inv.xeroStatus ?? "?"}
                    </span>
                  ) : showXeroLinking && xeroContactInvoices.length > 0 ? (
                    <form
                      action={linkInvoiceToXero.bind(null, inv.id, project.id)}
                      className="inline-form"
                      style={{ gap: 4 }}
                    >
                      <select name="xeroInvoiceId" required style={{ maxWidth: 200 }}>
                        <option value="">— link to —</option>
                        {xeroContactInvoices.map((xi) => (
                          <option key={xi.InvoiceID} value={xi.InvoiceID}>
                            {xi.InvoiceNumber ?? xi.InvoiceID.slice(0, 8)} · £{xi.SubTotal} · {xi.Status}
                          </option>
                        ))}
                      </select>
                      <select name="kind" defaultValue={inv.kind ?? ""} style={{ maxWidth: 100 }}>
                        <option value="">— role —</option>
                        {INVOICE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {invoiceKindLabel(k)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-sm btn-secondary">
                        Link
                      </button>
                    </form>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td>
                  {inv.xeroInvoiceId ? (
                    <span className={inv.paid ? "paid-yes" : "paid-no"}>{inv.paid ? "Paid ✓" : "Unpaid"}</span>
                  ) : (
                    <form action={toggleInvoicePaid.bind(null, inv.id, project.id)}>
                      <button
                        type="submit"
                        className={`btn btn-sm ${inv.paid ? "btn-secondary" : "btn-danger"}`}
                      >
                        {inv.paid ? "Paid ✓" : "Unpaid — mark paid"}
                      </button>
                    </form>
                  )}
                </td>
                <td>
                  {inv.xeroInvoiceId ? (
                    <form action={unlinkInvoiceFromXero.bind(null, inv.id, project.id)}>
                      <button
                        type="submit"
                        className="btn btn-ghost btn-sm"
                        style={{ color: "var(--muted)" }}
                        title="Unlink from Xero (keeps local row)"
                      >
                        unlink
                      </button>
                    </form>
                  ) : (
                    <form action={deleteInvoice.bind(null, inv.id, project.id)}>
                      <button type="submit" className="btn btn-ghost btn-sm" style={{ color: "var(--muted)" }}>
                        ✕
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {project.invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {xeroFetchError && <p className="error-msg mt">{xeroFetchError}</p>}
        {showXeroLinking && !xeroFetchError && xeroContactInvoices.length === 0 && (
          <p className="muted small mt">No unlinked Xero invoices found for this client.</p>
        )}
        <form action={addInvoice.bind(null, project.id)} className="inline-form mt">
          <div className="field">
            <label htmlFor="reference">Reference</label>
            <input id="reference" name="reference" required placeholder="INV-0001" />
          </div>
          <div className="field">
            <label htmlFor="amount">Amount £</label>
            <input id="amount" name="amount" type="number" step="0.01" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="add-kind">Role</label>
            <select id="add-kind" name="kind" defaultValue="">
              <option value="">— none —</option>
              {INVOICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {invoiceKindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" name="date" type="date" />
          </div>
          <div className="field">
            <label htmlFor="paid">Paid?</label>
            <input id="paid" name="paid" type="checkbox" style={{ width: "auto", height: 20 }} />
          </div>
          <button type="submit" className="btn">
            Add invoice
          </button>
        </form>
      </div>

      {xeroConn && isWebsite && (
        <div className="card">
          <h2>Deposit</h2>
          <p className="muted small">
            {project.depositPct}% of {gbp(project.totalValue)} ={" "}
            <strong>{gbp(depositAmount)}</strong> (ex-VAT). Adjust the deposit % in Details above.
          </p>
          {hasDeposit && (
            <p className="muted small">A deposit invoice has already been raised for this project.</p>
          )}
          <form action={raiseDepositInvoice.bind(null, project.id)}>
            <button type="submit" className="btn" disabled={depositAmount <= 0}>
              Raise {project.depositPct}% deposit — {gbp(depositAmount)} (DRAFT in Xero)
            </button>
          </form>
        </div>
      )}

      {xeroConn && (
        <div className="card">
          <h2>Raise invoice in Xero</h2>
          <p className="muted small">
            For interim and final invoices — add service lines (hosting, domain, etc.) and tag the role.
          </p>
          {!project.client.xeroContactId && (
            <p className="muted small">
              {project.client.name} isn&apos;t linked to Xero yet — a contact will be created in Xero
              automatically when you raise the first invoice.
            </p>
          )}
          <InvoiceBuilder
            services={services}
            defaultReference={project.title}
            action={createXeroInvoice.bind(null, project.id)}
            kindOptions={INVOICE_KINDS.map((k) => ({ value: k, label: invoiceKindLabel(k) as string }))}
            defaultKind={isWebsite ? "FINAL" : ""}
          />
        </div>
      )}

      <div className="card">
        <h2>Attachments</h2>
        {project.attachments.length === 0 && <p className="muted small">No links yet.</p>}
        <ul>
          {project.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank">
                {a.label}
              </a>{" "}
              <form action={deleteAttachment.bind(null, a.id, project.id)} style={{ display: "inline" }}>
                <button
                  type="submit"
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--muted)", padding: "0 6px" }}
                >
                  ✕
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addAttachment.bind(null, project.id)} className="inline-form">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="label">Label</label>
            <input id="label" name="label" required placeholder="Signed contract" />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="url">URL (SharePoint etc.)</label>
            <input id="url" name="url" type="url" required placeholder="https://…" />
          </div>
          <button type="submit" className="btn">
            Add link
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Notes</h2>
        <form action={addNote.bind(null, project.id)} className="stack">
          <textarea name="body" rows={3} placeholder="Add a note…" required />
          <div>
            <button type="submit" className="btn">
              Add note
            </button>
          </div>
        </form>
        <div className="mt">
          {project.notes.map((n) => (
            <div key={n.id} className="note">
              <div className="note-meta">
                {n.author} · {dateFmt(n.createdAt)}{" "}
                <form action={deleteNote.bind(null, n.id, project.id)} style={{ display: "inline" }}>
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    style={{ color: "var(--muted)", padding: "0 6px" }}
                  >
                    ✕
                  </button>
                </form>
              </div>
              <div className="note-body">{n.body}</div>
            </div>
          ))}
          {project.notes.length === 0 && <p className="muted small">No notes yet.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <form action={deleteProject.bind(null, project.id)}>
          <button type="submit" className="btn btn-danger">
            Delete project (and its invoices, notes, attachments)
          </button>
        </form>
      </div>
    </>
  );
}
