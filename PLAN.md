# WorldArchitect Hosted Multi-Tenant Deployment Plan

## Repo Map

- `server/src/db/index.ts` opens the local `better-sqlite3` database and applies schema/migration code from `server/src/db/schema.ts`.
- `server/src/routes/*.ts`, several `server/src/services/*.ts`, and some agents currently issue direct SQLite statements through `getDb()`.
- `server/src/routes/settings.ts` exposes provider settings as one global singleton plus per-world cost settings.
- `server/src/providers/index.ts` reads that singleton, merges env overrides, masks secrets on response, and enforces Phase A local-only egress rules.
- `server/src/index.ts` owns route mounting, CORS, `/health`, and startup initialization.
- `.github/workflows/ci.yml` currently runs install, typecheck, build, and tests.

## Design

WorldArchitect keeps `APP_MODE=local` as the default. Local mode remains unauthenticated and uses the existing SQLite database path and API behavior, with a single implicit owner id of `local-user`.

Hosted mode is selected with `APP_MODE=hosted`. Hosted mode requires an authenticated request and scopes access by `req.auth.userId`. Authentication will use Clerk-compatible JWT verification because Clerk gives a hosted user-management surface, standard bearer JWTs, JWKS rotation, and simple SPA integration. The server will require `CLERK_JWKS_URL` and verify issuer/audience when configured. Tests and local hosted development may use `ALLOW_DEV_AUTH_HEADER=1` with `x-worldarchitect-user-id`.

Storage will be split into an explicit data-access layer for app configuration, auth context, tenant guards, provider settings, and health checks. SQLite remains the only synchronous query engine used by the existing route bodies, so local behavior does not churn. Postgres support will be introduced through migration SQL and a storage adapter boundary that can be expanded route by route; hosted deployments are configured with `DATABASE_URL`, and compose provides a local Postgres target for migration validation.

Tenant model:

- Add `owner_id` to `worlds`.
- Add `owner_id` to owned world children: `articles`, `categories`, `world_bible_entries`, `world_bible_meta`, `world_snapshots`, `call_log`, `pending_drafts`, `cost_settings`, `name_bank`, `entity_mentions`, `article_issues`, `publish_history`, `world_issues`, `auditor_edge_proposals`, and `coherence_warnings`.
- Backfill existing rows to `local-user`.
- New local rows use `local-user`; new hosted rows use the authenticated user id.
- Hosted route middleware checks that every `:wid` belongs to the authenticated user before child routers run.
- High-risk world routes (`list`, `get`, `patch`, `delete`, settings, and world issue routes) query by both id and owner.

Provider settings:

- Local mode keeps the existing singleton row and response shape.
- Hosted mode stores settings per user in `provider_settings.id = userId`.
- App-submitted hosted API keys are encrypted at rest with `PROVIDER_SETTINGS_ENCRYPTION_KEY`, then decrypted only on the server to build the effective provider config.
- Env provider keys still override stored keys and are never written back.
- Client responses keep Phase A masking and never return raw keys.

Deployment:

- Add Docker production build.
- Add `docker-compose.yml` with Postgres for hosted-mode smoke testing.
- Add Railway/Fly-style env examples and health-check docs.
- Add `DEPLOY.md` documenting env vars, migrations, DNS, HTTPS/TLS, and custom domain setup.
- Extend GitHub Actions to build the Docker image and deploy on pushes to `main` when deployment secrets are present.

## Implementation Sequence

1. Add app-mode config, auth middleware, tenant helpers, schema owner columns, provider-setting encryption helpers, and tests for settings.
2. Scope world/settings/world-issue routes by tenant and add tenant isolation tests proving user A cannot read or mutate user B's worlds.
3. Add migration artifacts and the storage adapter boundary for SQLite/Postgres health and migrations without disrupting the current SQLite call sites.
4. Add Dockerfile, compose, production scripts, deployment docs, and CI image/deploy jobs.
5. Run the local test suite and typecheck; keep local mode as the default path.

## Commit Plan

- Commit 1: Phase B plan.
- Commit 2: app mode, auth context, tenant schema, encrypted per-user provider settings.
- Commit 3: tenant-scoped routes and isolation tests.
- Commit 4: storage/migration adapter artifacts for SQLite/Postgres.
- Commit 5: Docker, compose, deploy docs, and CI image/deploy workflow.
