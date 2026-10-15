# Business OS direction

GCW Projects will grow incrementally into a lightweight business operating
system. Prioritise work that reduces administration: clear project status and
next actions, capturing commitments, consistent quality, realistic workload
planning for Emlyn and Lowri, and better client communication and sign-off.

## Current increment: task management

Projects and ad hoc jobs share one task engine. Tasks carry assignment,
priority, delivery status, effort, dependencies, completion criteria and an
optional SOP link. A due date is a commitment; a planned date is an internal
scheduling decision. Neither is inferred from the other.

My Work, All Work, project tasks/progress, a weekly capacity planner and a
visual status board consume the same records. Capacity belongs to each staff
member and week. Unset capacity is unknown, never assumed to be a full week.

## Future increments — not implemented by this task release

- Central process, checklist and task-template library: onboarding, website
  build/testing/launch, Microsoft 365, migrations and maintenance.
- Versioned templates with project-specific customisation and selective updates
  to existing projects; never silently overwrite local changes.
- Flexible project stages that suggest or generate template tasks, approvals
  and client communications. Task completion alone must not advance stages.
- Operational dashboard showing stalled projects, client waits, commitments,
  available capacity and next actions.
- Client review/sign-off and communications, followed by automation and AI
  suggestions for priority, bottlenecks and workload adjustments.

Build these as explicit module interactions. Task templates should eventually
instantiate ordinary task records with provenance; task views must not depend
on a template engine. Keep accounting and recurring billing ownership intact.

The application remains Next.js/React, Prisma and SQLite. There is no PHP
backend in this repository. Interactive libraries can be added behind React
components when a concrete workflow needs them.
