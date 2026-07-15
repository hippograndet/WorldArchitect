# Agent Context

Read this before making non-trivial changes to WorldArchitect. The app is local-first by default, with an opt-in hosted multi-tenant mode backed by Postgres and Clerk.

## Code Placement

Before adding new files, moving logic, or touching an unfamiliar area, read:

- `dev-docs/engineering/code-map.md` for where code belongs and which existing files own common responsibilities.
- `dev-docs/engineering/practices.md` for safe-expansion principles, folder boundaries, and structural technical debt.
- `dev-docs/engineering/testing.md` for choosing the right verification commands and known test harness gotchas.
- `dev-docs/reference/system_layers.md` for the current app map.

## Server And Security Changes

For server routes, services, background jobs, database migrations, or tests, read these first:

- `dev-docs/engineering/code-map.md` for route/service/db/agent ownership boundaries.
- `docs/security.md` for tenant-isolation and secret-handling rules.
- `DEPLOY.md` for hosted-mode database roles, environment variables, and production checks.
- `server/src/routes/index.ts` for the route ownership boundary.
- `server/src/routes/postgresRoutes.test.ts` and `server/src/db/rlsRestrictedRole.test.ts` for tenant-isolation behavior coverage.

Tenant-data invariant: every route, service, and background job that touches tenant data must carry explicit `ownerId` scoping at the application layer. Postgres Row-Level Security is defense in depth, not a replacement for route guards, tenant context, or `owner_id` filters.

When adding or changing routes/jobs, check for:

- Routes outside `/api/worlds/:wid/...`.
- Raw IDs accepted in params or request bodies.
- Database reads/writes without `owner_id` filtering or an already-proven parent ownership join.
- Background work started without an explicit owner id.
- New tenant tables without RLS policies and restricted-role tests.

## Verification Habit

For tenant-affecting work, add behavior tests that prove:

- User A-created rows are absent from user B lists.
- Direct user B access to user A raw IDs returns `404`.
- Cross-tenant mutations return `404`, no-op, or an RLS failure.
- Background-created rows inherit the owning user id.
- New tenant tables are covered by restricted-role RLS tests.
