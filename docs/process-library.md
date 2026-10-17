# Process Library

Open **Work → Process Library**. Create named groups, add standard tasks and
optional prerequisite links, and save drafts or publish a version. Published
versions are immutable. Editing starts/replaces the next draft; publishing records
the author and change summary. Duplicate a group to use it as a starting point.
Archive groups instead of removing history.

Instructions and acceptance criteria are copied into project tasks. SOP links
open existing written procedures; linked external documents are not themselves
versioned here.

On either a project or an ad-hoc job, **Processes and templates → Apply template**
opens a review. Choose tasks and customise fields, staff assignments and dates.
Include prerequisites or remove the corresponding dependencies. Confirm to create
ordinary tasks, with source group/version labels in the task table. The normal
application is retry-safe. **Apply another copy** explicitly starts a separate
occurrence and holds its retry key until confirmation succeeds.

Define work types in the library, then assign one on a project's process panel.
A published group's suggestion rules may match project/ad-hoc type, current
stage and work type. Conditions within one rule are AND; multiple rules are OR.
Suggestions are computed when reading the project, so all stage-edit entry points
behave consistently. Application is always reviewed. Dismissals persist; dismissed
templates remain available in the manual picker. Publishing rules does not create
tasks. Automatic creation and recurring schedules are not enabled.

When publishing a new version, existing applications expose additions and
field-by-field comparisons of original template, current project and new template
values. Each field can be left for later, replaced, or explicitly kept locally.
Reviewed fields advance independently. Completed tasks default to no changes,
deleted tasks remain deleted, removed template items remain on the project, and
assignments, scheduling and completion never change through template updates.
Dependency changes must pass the existing project, cycle and completion rules.
Application history records who applied/reviewed changes. There is no bulk rollout
or automatic overwrite of existing project tasks.

## Database rollout

The upgrade is additive: eleven process/work-type tables plus a nullable foreign
key and index on Project. Existing tasks receive no inferred provenance. Existing
projects remain unclassified and no work types or template tasks are seeded.
Read-only preflight on 2026-10-17 found 86 projects, 6 tasks and 1 local user.
No existing rows require a backfill.

The upgrade was also verified against an isolated snapshot of the current
database: all original rows in all 24 existing tables matched their pre-upgrade
hashes, and foreign keys remained valid. The live database was opened read-only.

The container entrypoint runs `scripts/upgrade-process-library.mjs` before normal
schema sync. It runs `prisma/upgrades/20261017_process_library.sql` in one
transaction on an existing pre-library database and checks foreign keys. The SQL
adds the nullable classification without rebuilding Project. Fresh databases use
the normal schema sync. Repeated startup is safe; partial installations fail
explicitly. Existing backup databases are never modified.

For a local installation, set DATABASE_URL to the intended application database,
take a normal recoverable database backup, then run:

```sh
node scripts/upgrade-process-library.mjs
npx prisma db push
npx prisma generate
npm run build
```

The schema remains compatible with existing project/task data. Prefer leaving
additive tables/columns in place when rolling application code back. Do not delete
process tables after users have created templates or applied tasks; that would
discard provenance and review history. Restoring a database backup also discards
all changes since that backup and should only be an explicitly chosen recovery.

Optional later work: bulk review across projects, dedicated SOP document versions,
AI-drafted templates, relative-date rules, and explicitly enabled automatic task
creation. None is needed to manage and apply the library.
