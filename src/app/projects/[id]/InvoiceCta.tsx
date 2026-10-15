import Link from "next/link";
import { raiseAdhocInvoice, raiseDepositInvoice, raiseFinalInvoice } from "@/app/xero-actions";
import { ADHOC_ITEM_CODES, ADHOC_ITEM_CODE_DEFAULT, feeRemainder } from "@/lib/invoicing";
import { gbp } from "@/lib/status";

type Project = {
  id: string;
  type: string;
  stage: string;
  title: string;
  totalValue: number;
  depositPct: number;
  hoursDone: number | null;
  hoursQuoted: number | null;
  invoices: { amount: number; kind: string | null }[];
  client: { xeroContactId: string | null; name: string };
};

/**
 * The invoice worth raising right now, if there is one.
 *
 * Invoicing used to live at the bottom of the page behind a modal, which is the
 * wrong place for the one action a finished job actually needs. This works out
 * what's owed from the stage and what's already been invoiced, and puts a
 * single button at the top with the amount on it.
 *
 * Returns null when nothing is due, so the banner simply doesn't appear rather
 * than nagging through the whole life of a project.
 */
export function invoiceDue(project: Project): "ADHOC" | "DEPOSIT" | "BALANCE" | null {
  const isAdhoc = project.type === "ADHOC";
  const remainder = feeRemainder(project.totalValue, project.invoices);
  const hasDeposit = project.invoices.some((i) => i.kind === "DEPOSIT");
  if (remainder <= 0) return null;
  if (isAdhoc) return project.stage === "DONE" ? "ADHOC" : null;
  if (["GO_LIVE", "FINAL_TWEAKS", "LIVE"].includes(project.stage)) return "BALANCE";
  if (
    !hasDeposit &&
    project.depositPct > 0 &&
    ["ONBOARDING", "STRUCTURE_APPROVED", "DESIGNS_APPROVED"].includes(project.stage)
  ) {
    return "DEPOSIT";
  }
  return null;
}

export default function InvoiceCta({
  project,
  xeroConnected,
}: {
  project: Project;
  xeroConnected: boolean;
}) {
  const isAdhoc = project.type === "ADHOC";
  const remainder = feeRemainder(project.totalValue, project.invoices);
  const hasDeposit = project.invoices.some((i) => i.kind === "DEPOSIT");
  const deposit = Math.round(project.totalValue * (project.depositPct / 100) * 100) / 100;

  // One job, one invoice for ad-hoc; a project earns a deposit once it's under
  // way and the balance once the site is built. See `invoiceDue`.
  const due = invoiceDue(project);
  if (!due) return null;
  const adhocDue = due === "ADHOC";
  const depositDue = due === "DEPOSIT";

  const amount = depositDue ? Math.min(deposit, remainder) : remainder;
  const hours = project.hoursDone ?? project.hoursQuoted;

  const heading = adhocDue
    ? "This job is done — raise the invoice"
    : depositDue
      ? "Ready for a deposit"
      : hasDeposit
        ? "Ready for the closing invoice"
        : "Ready to invoice";

  const detail = adhocDue
    ? `${gbp(amount)}${hours ? ` · ${hours} hrs` : ""} — one draft in Xero, described from the work recorded here.`
    : depositDue
      ? `${gbp(amount)} — ${project.depositPct}% of ${gbp(project.totalValue)}.`
      : `${gbp(amount)} left of ${gbp(project.totalValue)}${
          hasDeposit ? ", after the deposit" : ""
        }. Any services on the project go on as their own lines.`;

  if (!xeroConnected) {
    return (
      <div className="card next-action">
        <h2>{heading}</h2>
        <p className="hint">
          {detail} Xero isn&apos;t connected — <Link href="/settings">connect it</Link> to raise it
          from here, or record one manually below.
        </p>
      </div>
    );
  }

  const action = adhocDue
    ? raiseAdhocInvoice.bind(null, project.id)
    : depositDue
      ? raiseDepositInvoice.bind(null, project.id)
      : raiseFinalInvoice.bind(null, project.id);

  return (
    <div className="card next-action">
      <h2>{heading}</h2>
      <p className="hint">{detail}</p>
      <div className="action-row">
        <form action={action} className="inline-form">
          {/* Only ad-hoc work needs saying which product it bills as; a deposit
              or balance is always the design-and-build fee. */}
          {adhocDue && (
            <div className="field">
              <label htmlFor="adhoc-item-cta">Bill as</label>
              <select id="adhoc-item-cta" name="itemCode" defaultValue={ADHOC_ITEM_CODE_DEFAULT}>
                {ADHOC_ITEM_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="btn">
            Raise draft — {gbp(amount)}
          </button>
        </form>
        <Link href={`/projects/${project.id}?modal=add`} className="btn btn-secondary">
          Build it line by line
        </Link>
      </div>
      {!project.client.xeroContactId && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          {project.client.name} isn&apos;t linked to Xero yet — a contact will be created
          automatically.
        </p>
      )}
    </div>
  );
}
