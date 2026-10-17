# GCW Projects: Agent Ground Rules

This repository is a modular monolith for project delivery, recurring services,
billing, and Xero integration. Keep it deployable as one Next.js application and
one database unless a task explicitly requires otherwise. Modularise through
clear ownership and interfaces, not through premature services or databases.

These instructions apply to the whole repository.

## Product and accounting conventions

- Monetary values are GBP and ex-VAT unless a field or interface explicitly
  says otherwise.
- Xero is the accounting system of record for issued invoice identity, status,
  and accounting totals.
- Local records add operational meaning to Xero data; they must not silently
  contradict it.
- Creating an invoice from this application creates a **draft** in Xero. Do not
  add approval, sending, payment, or voiding behaviour without an explicit
  requirement.
- Never regard a local deletion or unlink as permission to delete or void the
  corresponding object in Xero.
- Clients marked `isInternal` may be tracked but must not be invoiced.
- Preserve the distinction between a one-off project charge and an ongoing
  recurring commitment.

## Domain boundaries and ownership

Treat the following as separate modules even while some implementation remains
in `src/app` and `src/lib`:

### Customers

Owns `Client`, customer contact details, internal-client status, and the mapping
to a Xero contact.

- A client is shared reference data, not owned by projects or billing.
- Contact creation and lookup in Xero belong to the accounting integration.
- Before deleting a client, account for projects, websites, recurring services,
  and imported invoice data—not only projects.

### Projects

Owns `Project`, `ProjectService`, `Invoice`, `Note`, `Attachment`, `DevSite`, and
`ProjectFile` as project-operational records.

- Project stages describe delivery state, not accounting state.
- A `ProjectService` is a snapshot of something sold or chargeable on that
  project. Later catalogue edits must not silently rewrite that snapshot.
- A project invoice link associates a project with a Xero invoice. It is not a
  second accounting ledger.
- Project completion must not silently create ongoing billing commitments.

### Work management

`src/modules/work` owns `Task`, `TaskDependency` and `StaffWeekCapacity`.
Tasks reference existing projects (including ADHOC) and local staff users.
Task progress must never change project stages, fees, invoices or recurring
contracts. Dependencies are restricted to one project, must be acyclic, and
must be complete before a dependent task is marked done. Reopening a prerequisite
requires reopening its completed dependents first. Updates use a version check.

Dates are date-only ISO strings; weeks start on Monday in the London business
calendar. Capacity is explicitly entered per person/week (unset is unknown,
zero means unavailable). Full estimated effort counts against the planned week,
including completed tasks; it is not time tracking or daily scheduling.
Authentication belongs to the server adapters; all work mutations use the shared
application operations, which validate parent and assignee relationships.
A task may be deleted only when no other task depends on it. Converting an
ad-hoc job's free-text details into tasks is an explicit, retry-safe action
that skips titles already on the job and leaves the details text unchanged.

Work also owns the Process Library: `WorkType`, `ProcessTemplate`, immutable
published `ProcessRevision` records, stable `ProcessItem` identities and their
revision content/dependencies, `ProcessRule`, `ProcessApplication`,
`AppliedProcessItem`, `ProcessDismissal` and `ProcessChange`. Projects own their
optional work-type assignment; work validates and updates it through its shared
operation. Stage/work-type rules produce read-time suggestions, never writes.
Dismissals persist across stage re-entry. Applying a template is an explicit,
reviewed, transactional snapshot into the same Task engine for PROJECT and ADHOC.
Application identity is project + template + occurrence (`primary` or an explicit
copy's retry key), never names or titles. Deleting an applied task preserves its
source-item tombstone. Template updates require per-field review, version checks,
dependency validation and an audit event; assignments, scheduling and task status
are not template-managed. Applied item baseline JSON is a validated ProcessFields
snapshot: only reviewed fields advance, including explicit keep-project choices.
Published revisions cannot be edited or deleted by application operations;
archive groups to retain provenance. SOP instructions/acceptance criteria are
snapshotted; external SOP links reference documents whose external content is not
versioned by this app.

### Catalogue

Owns `Service` and product/service defaults such as descriptions, prices,
units, categories, and Xero item mappings.

- Catalogue records are templates, not customer contracts.
- Copying catalogue values into a project line or recurring contract creates a
  deliberate snapshot unless the feature explicitly documents live pricing.
- Avoid the ambiguous unqualified term "service" in new APIs. Prefer
  `catalogueItem`, `projectLine`, or `recurringContract` according to meaning.

### Recurring services

Owns `Website` and `RecurringService` and their operational lifecycle.

- A `RecurringService` is an ongoing customer commitment, not an invoice line.
- `renewalDate`, `termMonths`, ownership/management, cancellation, quantity,
  cost, and sell price belong to the recurring contract.
- Cancellation and inactivity have different meanings; preserve that
  distinction.
- A project-to-recurring transition must be an explicit, idempotent handover.
  Prefer provenance such as source project/project-line identifiers rather than
  matching mutable descriptions.
- Once handed over, the recurring module owns the contract. Subsequent project
  edits must not silently change it.

### Billing and reconciliation

Owns billing-period calculation, billing runs, `ServiceBilling`, matching,
review, and allocations from imported Xero invoice lines.

- `ServiceBilling` records which period of a recurring contract was covered.
- Billing calculations should remain pure functions where possible. Keep date,
  period, price, and matching logic out of React components and server actions.
- Raising the same recurring period twice must not create duplicate coverage.
- Imported Xero lines are evidence from the ledger. Human review decisions must
  survive later synchronization.
- Do not infer a recurring commitment merely because a project line is named
  "hosting" or "domain". Use an explicit handover or confirmed mapping.

### Accounting integration

Owns `XeroConnection`, `XeroItem`, `XeroInvoiceLine`, `XeroInvoiceRef`, token
handling, Xero API calls, contact resolution, and external invoice creation and
synchronization.

- This must be the only boundary that calls Xero.
- Projects and billing may depend on a small accounting gateway; they must not
  depend on each other's server-action files to reach Xero.
- Never log access tokens, refresh tokens, client secrets, authorization codes,
  or raw credentials.
- Xero refresh tokens rotate. Persist a successfully refreshed token before
  relying on it for later requests.
- External identifiers must be treated as stable identity. Add uniqueness or
  idempotency protection where the business rule requires it.

### Reporting and client overview

Reporting may read across domains, but it does not own their data and must not
become an alternative write path. Cross-domain screens should compose read
models rather than move business rules into page components.

## Dependency direction

Preferred flow:

```text
page / component / route / MCP tool
                |
                v
        application operation
                |
                v
       domain logic + repository
                |
                v
       Prisma / accounting gateway
```

- UI components should render data and collect input, not calculate accounting
  truth or perform persistence.
- Server actions, route handlers, and MCP tools are adapters. Keep them thin and
  route them through the same application operations so behaviour cannot drift
  by entry point.
- Do not import one domain's server actions into another domain. Extract shared
  behaviour into an application or integration service instead.
- Do not introduce a generic utility or repository that hides domain ownership.
  A little duplication is preferable to a misleading abstraction.
- Pure domain code must not import Next.js, React, Prisma, or server actions.
- Database transactions belong around a complete business operation, especially
  when recording an external invoice and its local allocations.

## Target source layout

New domain logic should move toward this layout as touched; do not perform a
large mechanical relocation without a task that justifies it:

```text
src/
  modules/
    customers/
    catalogue/
    projects/
    recurring/
    billing/
    accounting/
      xero/
    reporting/
  app/                 # Next.js pages, route handlers, and thin actions
  lib/                 # genuinely cross-cutting technical utilities only
```

Within a module, use plain names such as `domain`, `application`, and
`repository` only when the distinction adds value. Avoid ceremony for a module
with one or two files.

Existing code does not yet fully follow this structure. Improve boundaries
incrementally when changing an area; do not mix an unrelated repository-wide
refactor into a focused feature or bug fix.

## Data-flow rules

### Project to recurring handover

The intended transition is:

```text
project reaches the appropriate delivery point
  -> user reviews ongoing items
  -> application creates or links website
  -> application creates recurring contracts with source provenance
  -> recurring/billing modules own future renewals
```

- Make this action explicit to the user.
- Make it safe to retry.
- Show what was created, skipped, or already linked.
- Require the information billing needs: client, website/domain where relevant,
  catalogue mapping, quantity, price, term, and start/renewal date.
- Do not keep project and recurring records in perpetual two-way sync.

### Invoice data

Use these meanings consistently:

- `Invoice`: a project's association and operational view of a Xero invoice (or
  an explicitly manual historical entry).
- `XeroInvoiceLine`: imported ledger line used for history and reconciliation.
- `ServiceBilling`: allocation of invoice evidence to a recurring period.

When the same Xero invoice appears in multiple local representations, reconcile
by Xero identifier. Do not use invoice number, description, client name, or
amount as identity when the Xero ID is available.

## Database and migration rules

- Preserve existing data. Inspect current rows and likely backfill behaviour
  before changing a model or constraint.
- Use explicit relations and indexes for durable cross-record references. Avoid
  adding unvalidated string foreign keys.
- Prefer structured fields and relations over encoding new state in descriptions
  or `Setting` values.
- Use enums at the TypeScript/domain boundary even where legacy SQLite fields
  remain strings. Validate all external and form input before persistence.
- Represent money consistently. Existing fields use `Float`; do not compound
  rounding problems. Round at defined boundaries and consider a deliberate
  Decimal/minor-unit migration for any substantial accounting redesign.
- Dates representing billing periods must have documented inclusive/exclusive
  semantics. Reuse the recurring period helpers rather than recreating date
  arithmetic.
- Schema changes require a migration/backfill plan and tests for existing data.
- Do not edit or remove backup databases under `data/` unless explicitly asked.

## Application operations

- Authenticate every mutation regardless of whether it is called from a page,
  route, or MCP tool.
- Validate ownership and parent-child relationships. An ID plus a separately
  supplied parent ID is not proof that the row belongs to that parent.
- Prefer idempotent operations for imports, synchronization, handovers, and
  invoice creation. Where an external call can succeed before a local write
  fails, provide a reconciliation path.
- Revalidation and redirects are adapter concerns; domain/application services
  should return results rather than call Next.js navigation APIs.
- Error messages should tell an operator what failed and what state may already
  exist in Xero.

## Tests and verification

Test behaviour at the narrowest useful layer:

- Pure unit tests for stage transitions, invoice balances, billing periods,
  pricing, descriptions, and matching.
- Database-backed tests for uniqueness, cascades, handover idempotency, billing
  allocations, and synchronization writes.
- End-to-end tests for a small number of critical workflows.

Critical workflows include:

1. Create and progress a project.
2. Raise and link deposit/final/ad-hoc project invoices.
3. Hand a delivered project's ongoing services into recurring contracts.
4. Run recurring billing without duplicating a covered period.
5. Import Xero invoice history and preserve reviewed allocations.
6. Prevent invoicing an internal client.

For code changes, run the most focused available checks first, then
`npm run build` for changes that can affect the integrated application. If a
relevant test is unavailable or cannot run, report that clearly.

## Change discipline

- The worktree may contain user changes. Inspect it first and do not overwrite,
  reset, reformat, or otherwise absorb unrelated work.
- Keep feature changes scoped. Separate architectural extraction from behaviour
  changes where practical.
- Preserve public routes and current workflows unless the task explicitly
  changes them.
- Update this file when introducing a new domain, changing data ownership, or
  establishing a new cross-domain contract.
- Add comments for business invariants and non-obvious accounting decisions;
  avoid comments that merely narrate the code.

**Whenever a significant amount of change is implemented, you should suggest committing to git by supplying the cmds to add files/folders, and the commit with a reasonably detailed message. also remind to push.**
