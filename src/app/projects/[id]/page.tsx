import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  updateProject,
  deleteProject,
  setProjectStage,
  setProjectStageFromForm,
  setProjectArchived,
  logHours,
  addInvoice,
  toggleInvoicePaid,
  deleteInvoice,
  setInvoiceKind,
  addNote,
  updateNote,
  deleteNote,
  addAttachment,
  deleteAttachment,
} from "@/app/actions";
import {
  stagesFor,
  stageLabel,
  stageAction,
  nextStage,
  canMarkLost,
  lifecycleOf,
  lifecycleLabel,
  LOST,
  gbp,
  dateFmt,
  monthFmt,
  dateTimeFmt,
  PROJECT_TYPES,
  projectTypeLabel,
  INVOICE_KINDS,
  invoiceKindLabel,
} from "@/lib/status";
import { getConnection, getContactInvoices, type XeroInvoice } from "@/lib/xero";
import {
  createXeroInvoice,
  raiseDepositInvoice,
  raiseAdhocInvoice,
  linkNewInvoiceFromXero,
  syncProjectInvoices,
} from "@/app/xero-actions";
import InvoiceBuilder from "./InvoiceBuilder";

export const dynamic = "force-dynamic";

const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const dateTimeInput = (d: Date) => d.toISOString().slice(0, 16);

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ modal?: string }>;
}) {
  const { id } = await params;
  const { modal } = await searchParams;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      invoices: { orderBy: { date: "asc" } },
      notes: { orderBy: { timestamp: "desc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) notFound();

  const isAdhoc = project.type === "ADHOC";
  const lifecycle = lifecycleOf(project);
  const action = stageAction(project.type, project.stage);
  const next = nextStage(project.type, project.stage);
  const track = stagesFor(project.type);
  const currentIdx = (track as readonly string[]).indexOf(project.stage);

  const invoiced = project.invoices.reduce((s, i) => s + i.amount, 0);
  const left = project.totalValue - invoiced;
  const depositAmount = Math.round(project.totalValue * (project.depositPct / 100) * 100) / 100;
  const hasDeposit = project.invoices.some((i) => i.kind === "DEPOSIT");

  const xeroConn = await getConnection();
  const showAddModal = modal === "add";
  const showLinkModal = modal === "link" && !!xeroConn && !!project.client.xeroContactId;

  const services =
    showAddModal && xeroConn
      ? await prisma.service.findMany({
          where: { active: true },
          orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
          select: { id: true, name: true, price: true, unit: true, category: true },
        })
      : [];

  let xeroContactInvoices: XeroInvoice[] = [];
  let xeroFetchError: string | null = null;
  if (showLinkModal) {
    try {
      const alreadyLinked = new Set(project.invoices.map((i) => i.xeroInvoiceId).filter(Boolean));
      xeroContactInvoices = (await getContactInvoices(project.client.xeroContactId!)).filter(
        (xi) => !alreadyLinked.has(xi.InvoiceID)
      );
    } catch (e) {
      xeroFetchError = e instanceof Error ? e.message : "Xero fetch failed";
    }
  }

  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  const base = `/projects/${project.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{project.title}</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            <Link href={`/clients/${project.clientId}`}>{project.client.name}</Link>
            {project.client.contactName ? ` · ${project.client.contactName}` : ""}
            {project.client.email ? ` · ${project.client.email}` : ""}
          </p>
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge badge-type">{projectTypeLabel(project.type)}</span>
          <span className={`badge badge-life-${lifecycle}`}>{lifecycleLabel(lifecycle)}</span>
          <span className={`badge badge-stage`}>{stageLabel(project.stage)}</span>
        </span>
      </div>

      {/* Stage track */}
      {project.stage === LOST ? (
        <div className="lost-banner">
          This enquiry was marked <strong>lost</strong>.
          <form action={setProjectStage.bind(null, project.id, "ENQUIRY")} style={{ display: "inline" }}>
            <button type="submit" className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }}>
              Reopen as enquiry
            </button>
          </form>
        </div>
      ) : (
        <div className="stepper">
          {track.map((s, i) => (
            <span
              key={s}
              className={`step ${i < currentIdx ? "done" : i === currentIdx ? "current" : "todo"}`}
            >
              {stageLabel(s)}
            </span>
          ))}
        </div>
      )}

      {/* Next action */}
      <div className="card next-action">
        <h2>What&apos;s next</h2>
        <p className="hint">{action.hint}</p>
        <div className="action-row">
          {next && (
            <form action={setProjectStage.bind(null, project.id, next)}>
              <button type="submit" className="btn">
                {action.advance} →
              </button>
            </form>
          )}
          {action.suggestInvoice && (
            <Link href={`${base}?modal=add`} className="btn btn-secondary">
              {isAdhoc ? "Invoice this job" : !hasDeposit && project.stage === "ONBOARDING" ? "Raise deposit" : "Add invoice"}
            </Link>
          )}
          {canMarkLost(project.stage) && (
            <form action={setProjectStage.bind(null, project.id, LOST)}>
              <button type="submit" className="btn btn-danger">
                Mark lost
              </button>
            </form>
          )}
          {action.suggestArchive && !project.archived && (
            <form action={setProjectArchived.bind(null, project.id, true)}>
              <button type="submit" className="btn btn-secondary">
                Archive
              </button>
            </form>
          )}
          {project.archived && (
            <form action={setProjectArchived.bind(null, project.id, false)}>
              <button type="submit" className="btn btn-secondary">
                Unarchive
              </button>
            </form>
          )}
          {project.stage !== LOST && (
            <details className="stage-jump">
              <summary className="btn btn-ghost btn-sm">Move to stage…</summary>
              <form action={setProjectStageFromForm.bind(null, project.id)} className="inline-form mt">
                <select name="stage" defaultValue={project.stage}>
                  {track.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-sm">
                  Move
                </button>
              </form>
            </details>
          )}
        </div>
      </div>

      {/* Report facts */}
      <div className="facts">
        <div className="fact">
          <div className="label">{isAdhoc ? "Amount quoted" : "Total value"}</div>
          <div className="value">{gbp(project.totalValue)}</div>
        </div>
        <div className="fact">
          <div className="label">Invoiced</div>
          <div className="value">{gbp(invoiced)}</div>
        </div>
        <div className="fact">
          <div className="label">Left to invoice</div>
          <div className="value">{gbp(left)}</div>
        </div>
        <div className="fact">
          <div className="label">Start</div>
          <div className="value">{project.startDate ? monthFmt(project.startDate) : "—"}</div>
        </div>
        <div className="fact">
          <div className="label">Expected finish</div>
          <div className="value">{project.targetDate ? monthFmt(project.targetDate) : "—"}</div>
        </div>
        {isAdhoc ? (
          <div className="fact">
            <div className="label">Hours: quoted / done</div>
            <div className="value">
              {project.hoursQuoted ?? "—"} / {project.hoursDone ?? "—"}
            </div>
            <form action={logHours.bind(null, project.id)} className="inline-form" style={{ marginTop: 6 }}>
              <input
                name="hoursDone"
                type="number"
                step="0.25"
                min="0"
                defaultValue={project.hoursDone ?? ""}
                style={{ width: 80 }}
                aria-label="Hours done"
              />
              <button type="submit" className="btn btn-ghost btn-sm">
                Log
              </button>
            </form>
          </div>
        ) : (
          <div className="fact">
            <div className="label">Deposit ({project.depositPct}%)</div>
            <div className="value">
              {gbp(depositAmount)} {hasDeposit ? "✓ raised" : ""}
            </div>
          </div>
        )}
        {project.proposalUrl && (
          <div className="fact">
            <div className="label">Proposal</div>
            <div className="value">
              <a href={project.proposalUrl} target="_blank">
                Open ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Invoices */}
      <div className="card">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`${base}?modal=add`} className="btn btn-sm">
              + Add invoice
            </Link>
            {xeroConn && project.client.xeroContactId && (
              <Link href={`${base}?modal=link`} className="btn btn-secondary btn-sm">
                Link Xero invoice
              </Link>
            )}
            {xeroConn && project.invoices.some((i) => i.xeroInvoiceId) && (
              <form action={syncProjectInvoices.bind(null, project.id)}>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Sync from Xero
                </button>
              </form>
            )}
          </div>
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
                    <select name="kind" defaultValue={inv.kind ?? ""} style={{ maxWidth: 120 }}>
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
                  <form action={deleteInvoice.bind(null, inv.id, project.id)}>
                    <button
                      type="submit"
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--muted)" }}
                      title={inv.xeroInvoiceId ? "Remove row (Xero invoice untouched)" : "Delete"}
                    >
                      ✕
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {project.invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No invoices yet — use <Link href={`${base}?modal=add`}>Add invoice</Link>
                  {xeroConn && project.client.xeroContactId ? (
                    <>
                      {" "}
                      or <Link href={`${base}?modal=link`}>link one from Xero</Link>
                    </>
                  ) : null}
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="card">
        <h2>Notes</h2>
        <form action={addNote.bind(null, project.id)} className="stack">
          <textarea name="body" rows={3} placeholder="Add a note…" required />
          <div className="inline-form">
            <div className="field">
              <label htmlFor="note-ts">When (optional — defaults to now)</label>
              <input id="note-ts" name="timestamp" type="datetime-local" />
            </div>
            <button type="submit" className="btn">
              Add note
            </button>
          </div>
        </form>
        <div className="mt">
          {project.notes.map((n) => (
            <div key={n.id} className="note">
              <div className="note-meta">
                {n.author} · {dateTimeFmt(n.timestamp)}
                <details className="note-edit">
                  <summary>edit</summary>
                  <form action={updateNote.bind(null, n.id, project.id)} className="stack mt">
                    <textarea name="body" rows={3} defaultValue={n.body} required />
                    <div className="inline-form">
                      <input name="timestamp" type="datetime-local" defaultValue={dateTimeInput(n.timestamp)} />
                      <button type="submit" className="btn btn-sm">
                        Save
                      </button>
                    </div>
                  </form>
                </details>
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

      {/* Attachments */}
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

      {/* Edit details — collapsed; the report above is the main view */}
      <details className="card card-collapse">
        <summary>
          <h2 style={{ display: "inline", margin: 0 }}>Edit details</h2>
        </summary>
        <form action={updateProject.bind(null, project.id)} className="stack mt">
          <div className="field">
            <label htmlFor="title">{isAdhoc ? "Description" : "Title"}</label>
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
              <label htmlFor="totalValue">{isAdhoc ? "Amount quoted £" : "Total value £"} (ex-VAT)</label>
              <input
                id="totalValue"
                name="totalValue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={project.totalValue}
              />
            </div>
            {!isAdhoc && (
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
            )}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="startDate">Start date</label>
              <input id="startDate" name="startDate" type="date" defaultValue={dateInput(project.startDate)} />
            </div>
            <div className="field">
              <label htmlFor="targetDate">Expected finish</label>
              <input id="targetDate" name="targetDate" type="date" defaultValue={dateInput(project.targetDate)} />
            </div>
            {isAdhoc && (
              <>
                <div className="field">
                  <label htmlFor="hoursQuoted">Hours quoted</label>
                  <input
                    id="hoursQuoted"
                    name="hoursQuoted"
                    type="number"
                    step="0.25"
                    min="0"
                    defaultValue={project.hoursQuoted ?? ""}
                  />
                </div>
                <div className="field">
                  <label htmlFor="hoursDone">Hours done</label>
                  <input
                    id="hoursDone"
                    name="hoursDone"
                    type="number"
                    step="0.25"
                    min="0"
                    defaultValue={project.hoursDone ?? ""}
                  />
                </div>
              </>
            )}
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
          <input type="hidden" name="stage" value={project.stage} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn">
              Save changes
            </button>
          </div>
        </form>
        <div className="mt" style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <form action={deleteProject.bind(null, project.id)}>
            <button type="submit" className="btn btn-danger btn-sm">
              Delete project (and its invoices, notes, attachments)
            </button>
          </form>
        </div>
      </details>

      {/* ---------- Add invoice modal ---------- */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Add invoice</h2>
              <Link href={base} className="btn btn-ghost btn-sm">
                ✕ Close
              </Link>
            </div>

            {xeroConn ? (
              <>
                {isAdhoc && (
                  <div className="modal-section">
                    <h3>Invoice this job</h3>
                    <p className="muted small">
                      One line, prefilled: <strong>{project.title}</strong>
                      {project.hoursDone ?? project.hoursQuoted
                        ? ` (${project.hoursDone ?? project.hoursQuoted} hrs)`
                        : ""}{" "}
                      — {gbp(project.totalValue)} ex-VAT, tagged Ad-hoc work.
                    </p>
                    <form action={raiseAdhocInvoice.bind(null, project.id)}>
                      <button type="submit" className="btn" disabled={project.totalValue <= 0}>
                        Raise {gbp(project.totalValue)} invoice (DRAFT in Xero)
                      </button>
                    </form>
                  </div>
                )}

                {!isAdhoc && !hasDeposit && (
                  <div className="modal-section">
                    <h3>Deposit</h3>
                    <p className="muted small">
                      {project.depositPct}% of {gbp(project.totalValue)} = <strong>{gbp(depositAmount)}</strong>{" "}
                      (ex-VAT), tagged Deposit.
                    </p>
                    <form action={raiseDepositInvoice.bind(null, project.id)}>
                      <button type="submit" className="btn" disabled={depositAmount <= 0}>
                        Raise {gbp(depositAmount)} deposit (DRAFT in Xero)
                      </button>
                    </form>
                  </div>
                )}

                <div className="modal-section">
                  <h3>Build an invoice</h3>
                  {!project.client.xeroContactId && (
                    <p className="muted small">
                      {project.client.name} isn&apos;t linked to Xero yet — a contact will be created
                      automatically.
                    </p>
                  )}
                  <InvoiceBuilder
                    services={services}
                    defaultReference={project.title}
                    action={createXeroInvoice.bind(null, project.id)}
                    kindOptions={INVOICE_KINDS.map((k) => ({ value: k, label: invoiceKindLabel(k) as string }))}
                    defaultKind={isAdhoc ? "ADHOC" : hasDeposit ? "FINAL" : "DEPOSIT"}
                  />
                </div>
              </>
            ) : (
              <p className="muted small">
                Xero isn&apos;t connected — connect it in <Link href="/settings">Settings</Link> to raise
                invoices directly. You can still record one manually below.
              </p>
            )}

            <div className="modal-section">
              <h3>Record manually</h3>
              <p className="muted small">For invoices raised outside Xero, or historic entries.</p>
              <form action={addInvoice.bind(null, project.id)} className="inline-form">
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
                  Add
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Link Xero invoice modal ---------- */}
      {showLinkModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Link a Xero invoice</h2>
              <Link href={base} className="btn btn-ghost btn-sm">
                ✕ Close
              </Link>
            </div>
            <p className="muted small">
              Xero invoices for <strong>{project.client.name}</strong> not yet linked to this project. Pick a
            role and link — amount, date and paid status come from Xero.
            </p>
            {xeroFetchError && <p className="error-msg">{xeroFetchError}</p>}
            {!xeroFetchError && xeroContactInvoices.length === 0 && (
              <p className="muted">No unlinked Xero invoices found for this client.</p>
            )}
            {xeroContactInvoices.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Reference</th>
                    <th className="num">Amount (ex-VAT)</th>
                    <th>Status</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {xeroContactInvoices.map((xi) => (
                    <tr key={xi.InvoiceID}>
                      <td>{xi.InvoiceNumber ?? xi.InvoiceID.slice(0, 8)}</td>
                      <td className="muted small">{xi.Reference ?? "—"}</td>
                      <td className="num">{gbp(xi.SubTotal)}</td>
                      <td>
                        <span className={`badge badge-xero-${xi.Status}`}>{xi.Status}</span>
                      </td>
                      <td colSpan={2}>
                        <form
                          action={linkNewInvoiceFromXero.bind(null, project.id)}
                          className="inline-form"
                          style={{ gap: 6 }}
                        >
                          <input type="hidden" name="xeroInvoiceId" value={xi.InvoiceID} />
                          <select name="kind" defaultValue="" style={{ maxWidth: 130 }}>
                            <option value="">— role —</option>
                            {INVOICE_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {invoiceKindLabel(k)}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn btn-sm">
                            Link
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
