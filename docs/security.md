# Security Notes

WorldArchitect is local-first and single-user by design in its default mode (`APP_MODE=local`): no account system, no hosted sync layer. The sections below describe that default.

WorldArchitect also supports an opt-in hosted mode (`APP_MODE=hosted`) for self-deployment, which adds Clerk-based authentication and per-user data isolation over Postgres. See [DEPLOY.md](../DEPLOY.md) for hosted-mode setup and required secrets.

## Hosted-Mode API Hardening

- Bearer tokens are verified against Clerk's JWKS using the `jose` library, with an explicit signing-algorithm allowlist.
- All API responses carry standard security headers (`helmet`).
- `/api/*` is rate-limited in hosted mode; local mode (a single trusted user) is never throttled.
- Every request is assigned a correlation id, returned as `X-Request-Id` and included in every related server log line, so a reported issue can be traced through the logs.

## Tenant Isolation

Hosted mode is multi-tenant: each authenticated Clerk user owns their own worlds, articles, settings, runs, snapshots, and generated metadata.

The first isolation layer is in the application. Hosted requests are authenticated, world-scoped routes verify that the requested world belongs to the current user, and server queries include `owner_id` filters for tenant-owned data.

Postgres Row-Level Security (RLS) is the second isolation layer. RLS is a Postgres feature that attaches access policies directly to database tables. For WorldArchitect, those policies compare each row's `owner_id` to a per-request Postgres setting named `app.current_owner_id`. The server sets that value from the authenticated request user before it runs tenant-scoped queries. If a future route or service accidentally forgets an `owner_id` predicate, Postgres should still hide rows owned by another user.

Long-running Forge work re-enters that tenant context explicitly with the run owner id before it touches Postgres. LangGraph checkpoint tables do not carry `owner_id` columns, so their RLS policies scope rows through `thread_id = runs.id`; checkpoint state is only visible to the owner of the parent run.

Before RLS, tenant isolation depended on application code alone: route guards, tenant context helpers, and explicit SQL filters. That is still necessary and remains the main API-level boundary, but RLS adds database-level defense in depth for hosted deployments.

RLS only provides that backstop when the runtime database role cannot bypass it. Hosted `DATABASE_URL` should use a restricted app role with `NOSUPERUSER NOBYPASSRLS`. Schema migrations should use a separate owner/migration role through `MIGRATION_DATABASE_URL` or an explicit migration release step. Local development may use a more powerful Postgres role, so behavior tests and explicit application-level `owner_id` filters still matter.

Local mode still behaves as a single-user app. It uses the implicit local user id and the same Postgres storage path, but it does not expose untrusted multi-user traffic.

## Tenant Isolation Change Checklist

Use this checklist for every new or changed route, service, background job, or table that touches tenant data:

- Lists return only the current user's rows.
- Direct raw IDs owned by another user return `404`.
- Cross-user mutations return `404`, no-op, or an RLS failure.
- Background-created rows inherit the owning user's `owner_id`.
- New tenant-owned tables have application-level owner scoping, RLS policies, runtime-role grants, and restricted-role tests.

Pay special attention to routes outside `/api/worlds/:wid/...`, raw IDs in params or bodies, export/import/snapshot/restore flows, agent callbacks, run-event reads, and any background work started from a request. Use the shared helpers in `server/src/test/tenantIsolation.ts` when adding Postgres route behavior tests.

## Provider Secrets

- Users can enter provider keys in the app Settings screen.
- Keys are stored in the app database and are returned to the client only as masked values. Hosted-mode stored provider keys are encrypted with `PROVIDER_SETTINGS_ENCRYPTION_KEY`.
- Environment variables can override stored keys for operator workflows, but env keys are not persisted.
- Startup scans tracked project files for obvious committed provider keys and fails loudly if one is found.

## Self-Hosted Security Checklist

- Generate a strong `PROVIDER_SETTINGS_ENCRYPTION_KEY` and keep it stable across deploys.
- Never commit `.env`, `.env.local`, database URLs, provider keys, Clerk secrets, or encryption keys.
- Use HTTPS for hosted mode.
- Set `PUBLIC_BASE_URL` to the exact deployed `https://` origin so CORS allows only the intended browser origin.
- Configure `CLERK_ISSUER` and `CLERK_JWKS_URL` from the same Clerk application used by `VITE_CLERK_PUBLISHABLE_KEY`.
- Configure Clerk allowed origins/callbacks for the deployed domain.
- Keep `ALLOW_DEV_AUTH_HEADER` disabled in production.
- Rotate provider keys and deployment secrets if they are exposed.

## Data Egress

AI features are optional. Hosted LLM providers may receive relevant world context only when configured and invoked.

Local-only mode blocks Anthropic, OpenAI, and Groq provider calls and permits only Ollama. `WORLDARCHITECT_LOCAL_ONLY=1` forces that mode regardless of app settings.

## Prompt And Output Safety

World/article/user content is wrapped as untrusted data in prompts and context-tool responses. Agent output is zod-validated before generated drafts, links, warnings, or mentions can mutate the database.

## Observability

Logs are structured JSON, redact API-key-shaped values, and include a request correlation id and user id where available. `SENTRY_DSN` enables a Sentry-compatible error hook; without a DSN it is a no-op.
