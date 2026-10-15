# Task management

Use Work → My Work, All Work, Weekly Planner or Kanban. Tasks and milestones
also appear within each project/ad hoc job. Quick add requires only a title
and project; expand Details to plan effort, set prerequisites or add an SOP.
Click a task title to edit, reschedule or change its status. The board uses the
same editor and supports keyboard use; it does not use drag-and-drop.

Assignees are existing local staff/admin accounts. Staff must have signed in
once (or have an account provisioned) before they appear. All admitted staff
can view and manage business-wide work, consistent with the existing app.

Dependencies are within a single project/job. Cycles and self-links are
rejected. Prerequisites must be done before completion. Reopen completed
dependents before reopening a prerequisite. Criteria describe what must be
checked; the person marking Done is responsible for checking them.

Task progress is completed count / total count; milestones are flagged tasks.
Neither task completion nor milestone completion changes project stages or
invoicing. Archived projects are excluded from business-wide views.

The weekly planner uses Monday–Sunday date-only periods. Set available hours
for each person/week after leave and other commitments; zero means no capacity,
blank means unknown. The complete estimate is allocated to the planned week,
including completed work. Totals do not change with display filters. Missing
estimates, unassigned tasks and unscheduled work remain visible. This release
does not split a task across days/weeks or track actual time.

## Additive schema rollout

The change adds Task, TaskDependency and StaffWeekCapacity tables and indexes.
It does not rewrite existing project, staff or financial records. No backfill
is needed; existing projects initially have no tasks and capacity is unset.

Before deployment, take a consistent SQLite backup (stop the app before copying
the database, or use SQLite's online backup facility), plus uploaded files.
The existing JSON backup facility is a partial legacy export and does **not**
include tasks or capacity; use full database backups for this release.

On the intended deployment database, after that backup:

```sh
npx prisma generate
npx prisma db push --skip-generate
npm run build
```

Inspect any schema warning; do not accept data loss. Docker startup currently
also synchronises the schema, so take the backup before starting a new image.
Deploy the schema before serving the new pages. Rolling back application code
can leave the additive tables intact; do not drop them after task data exists.

Validation uses a disposable database and the isolated Playwright environment.
No production tasks, invoices or Xero calls are needed for tests.
