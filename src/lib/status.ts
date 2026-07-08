/**
 * Stage model.
 *
 * Every project has a `type` (PROJECT | ADHOC) and a `stage` on that type's
 * track. The coarse lifecycle (Enquiry / Active / Complete / Lost / Archived)
 * is DERIVED from stage + the archived flag, never stored — so the two can't
 * disagree.
 *
 *   PROJECT: Enquiry → Quoted → Onboarding → Structure Approved → Designs
 *            Approved → Design Done → Content Supplied → Client Feedback →
 *            Final Tweaks → Go Live → Live   (Lost branches off Enquiry/Quoted)
 *   ADHOC:   Enquiry → Quoted → Doing → Done → Invoiced   (Lost likewise)
 */

/* ---------- Project types ---------- */

export const PROJECT_TYPES = ["PROJECT", "ADHOC"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  PROJECT: "Project",
  ADHOC: "Ad-hoc",
};

export function projectTypeLabel(t: string): string {
  return PROJECT_TYPE_LABELS[t as ProjectType] ?? t;
}

export function isProjectType(t: string): t is ProjectType {
  return (PROJECT_TYPES as readonly string[]).includes(t);
}

/* ---------- Stages ---------- */

export const LOST = "LOST" as const;

export const ADHOC_STAGES = ["ENQUIRY", "QUOTED", "DOING", "DONE", "INVOICED"] as const;

export const PROJECT_STAGES = [
  "ENQUIRY",
  "QUOTED",
  "ONBOARDING",
  "STRUCTURE_APPROVED",
  "DESIGNS_APPROVED",
  "DESIGN_DONE",
  "CONTENT_SUPPLIED",
  "CLIENT_FEEDBACK",
  "FINAL_TWEAKS",
  "GO_LIVE",
  "LIVE",
] as const;

export type AdhocStage = (typeof ADHOC_STAGES)[number];
export type ProjectStage = (typeof PROJECT_STAGES)[number];
export type Stage = AdhocStage | ProjectStage | typeof LOST;

export const STAGE_LABELS: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTED: "Quoted",
  DOING: "Doing",
  DONE: "Done",
  INVOICED: "Invoiced",
  ONBOARDING: "Onboarding",
  STRUCTURE_APPROVED: "Structure Approved",
  DESIGNS_APPROVED: "Designs Approved",
  DESIGN_DONE: "Design Done",
  CONTENT_SUPPLIED: "Content Supplied",
  CLIENT_FEEDBACK: "Client Feedback",
  FINAL_TWEAKS: "Final Tweaks",
  GO_LIVE: "Go Live",
  LIVE: "Live",
  LOST: "Lost",
};

export function stageLabel(s: string): string {
  return STAGE_LABELS[s] ?? s;
}

/** The main track for a type (excludes LOST, which is a branch, not a step). */
export function stagesFor(type: string): readonly Stage[] {
  return type === "ADHOC" ? ADHOC_STAGES : PROJECT_STAGES;
}

export function isStageFor(type: string, s: string): s is Stage {
  return s === LOST || (stagesFor(type) as readonly string[]).includes(s);
}

/** Lost is only offered while still in the enquiry phase. */
export function canMarkLost(stage: string): boolean {
  return stage === "ENQUIRY" || stage === "QUOTED";
}

export function nextStage(type: string, stage: string): Stage | null {
  const track = stagesFor(type) as readonly string[];
  const i = track.indexOf(stage);
  if (i === -1 || i === track.length - 1) return null;
  return track[i + 1] as Stage;
}

/* ---------- Derived lifecycle ---------- */

export const LIFECYCLES = ["ENQUIRY", "ACTIVE", "COMPLETE", "LOST", "ARCHIVED"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  ENQUIRY: "Enquiry",
  ACTIVE: "Active",
  COMPLETE: "Complete",
  LOST: "Lost",
  ARCHIVED: "Archived",
};

export function lifecycleLabel(l: string): string {
  return LIFECYCLE_LABELS[l as Lifecycle] ?? l;
}

export function isLifecycle(l: string): l is Lifecycle {
  return (LIFECYCLES as readonly string[]).includes(l);
}

export function lifecycleOf(p: { type: string; stage: string; archived: boolean }): Lifecycle {
  if (p.archived) return "ARCHIVED";
  if (p.stage === LOST) return "LOST";
  if (p.stage === "ENQUIRY" || p.stage === "QUOTED") return "ENQUIRY";
  if (p.type === "ADHOC") return p.stage === "INVOICED" ? "COMPLETE" : "ACTIVE";
  return p.stage === "LIVE" ? "COMPLETE" : "ACTIVE";
}

/* ---------- Contextual next actions ---------- */

export type StageAction = {
  /** What's happening / what to do now — shown on the project report. */
  hint: string;
  /** Label for the advance button (moves to nextStage). Null at end of track. */
  advance: string | null;
  /** Suggest raising an invoice at this stage. */
  suggestInvoice?: boolean;
  /** Suggest archiving at this stage. */
  suggestArchive?: boolean;
};

const ADHOC_ACTIONS: Record<AdhocStage, StageAction> = {
  ENQUIRY: { hint: "New enquiry — put a quote together.", advance: "Mark quoted" },
  QUOTED: { hint: "Quote sent — waiting on the go-ahead.", advance: "Start work" },
  DOING: { hint: "Work in progress — log hours as you go.", advance: "Mark done" },
  DONE: { hint: "Work finished — invoicing is the next step.", advance: "Mark invoiced", suggestInvoice: true },
  INVOICED: { hint: "Invoiced. Archive once paid and wrapped up.", advance: null, suggestArchive: true },
};

const PROJECT_ACTIONS: Record<ProjectStage, StageAction> = {
  ENQUIRY: { hint: "New enquiry — put a proposal/quote together.", advance: "Mark quoted" },
  QUOTED: { hint: "Proposal with the client — chase if it's gone quiet.", advance: "Won — start onboarding" },
  ONBOARDING: {
    hint: "Kick-off: deposit, credentials, content plan — agree the site structure.",
    advance: "Structure approved",
    suggestInvoice: true, // deposit
  },
  STRUCTURE_APPROVED: { hint: "Structure signed off — send designs next.", advance: "Designs approved" },
  DESIGNS_APPROVED: { hint: "Designs signed off — build them out.", advance: "Design done" },
  DESIGN_DONE: { hint: "Build done — chase the client for content.", advance: "Content supplied" },
  CONTENT_SUPPLIED: { hint: "Content in — populate the site and send for client review.", advance: "Feedback received" },
  CLIENT_FEEDBACK: { hint: "Working through client feedback and changes.", advance: "Final tweaks" },
  FINAL_TWEAKS: { hint: "Last adjustments before launch.", advance: "Go live" },
  GO_LIVE: { hint: "Launching — DNS, SSL, final checks. Raise the final invoice.", advance: "Mark live", suggestInvoice: true },
  LIVE: { hint: "Live. Check the final invoice is raised, then archive.", advance: null, suggestInvoice: true, suggestArchive: true },
};

const LOST_ACTION: StageAction = { hint: "Enquiry lost.", advance: null, suggestArchive: true };

export function stageAction(type: string, stage: string): StageAction {
  if (stage === LOST) return LOST_ACTION;
  if (type === "ADHOC") return ADHOC_ACTIONS[stage as AdhocStage] ?? { hint: "", advance: null };
  return PROJECT_ACTIONS[stage as ProjectStage] ?? { hint: "", advance: null };
}

/* ---------- Invoice roles ---------- */

export const INVOICE_KINDS = ["DEPOSIT", "INTERIM", "FINAL", "ADHOC"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  DEPOSIT: "Deposit",
  INTERIM: "Interim",
  FINAL: "Final",
  ADHOC: "Ad-hoc work",
};

export function invoiceKindLabel(k: string | null | undefined): string | null {
  if (!k) return null;
  return INVOICE_KIND_LABELS[k as InvoiceKind] ?? k;
}

export function isInvoiceKind(k: string): k is InvoiceKind {
  return (INVOICE_KINDS as readonly string[]).includes(k);
}

/* ---------- Formatting ---------- */

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

export const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);

/** Month-level display for project dates ("Jul 2026"). */
export const monthFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(d);

export const dateTimeFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
