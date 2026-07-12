# Self-Hosted Operations

WorldArchitect can run in two modes:

- `APP_MODE=local` - single-user local mode, no account system, Postgres storage.
- `APP_MODE=hosted` - self-hosted web app mode with Clerk auth and Postgres storage.

This page describes the operational habits for hosted self-deployment. It is not a SaaS operations manual; it is the practical checklist for running your own instance responsibly.

## Beta Readiness Checklist

Before calling a deployment self-hosted beta ready:

- Deploy from a clean checkout using [DEPLOY.md](../DEPLOY.md).
- Use Postgres for hosted mode.
- Use separate Postgres roles for migrations and runtime traffic.
- Use HTTPS and set `PUBLIC_BASE_URL` to the final public origin.
- Configure Clerk for the same origin.
- Set a stable `PROVIDER_SETTINGS_ENCRYPTION_KEY`.
- Confirm `/health` reports hosted mode and Postgres storage.
- Confirm the runtime database role is not a superuser and does not have `BYPASSRLS`.
- Create and restore at least one database backup.
- Confirm world ZIP export works for a real world.
- Run the manual QA checklist in [DEPLOY.md](../DEPLOY.md).

## Data Ownership

For hosted mode, Postgres is the authoritative database. It contains worlds, articles, snapshots, drafts, provider settings, call logs, and internal metadata.

World ZIP export is useful for user-readable content backup, but it is not a complete operational backup. Keep database backups.

## Backup And Restore

Use your database provider's automatic backups if available. Hosted mode uses Postgres as the system of record, so a database backup is the backup that matters for recovery.

For manual backups, prefer custom-format `pg_dump`:

```sh
pg_dump --format=custom --file=worldarchitect-backup.dump "$MIGRATION_DATABASE_URL"
```

Use an owner, migration, or dedicated backup connection for full backups. The restricted runtime `DATABASE_URL` is protected by RLS and, without a tenant context, should not be able to read tenant rows. Store backups somewhere separate from the app host. Treat backups as sensitive because they may include private world content and encrypted provider keys.

Restore into a fresh empty database with:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$MIGRATION_DATABASE_URL" worldarchitect-backup.dump
```

If you use SQL-format dumps instead:

```sh
pg_dump "$MIGRATION_DATABASE_URL" > worldarchitect-backup.sql
psql "$MIGRATION_DATABASE_URL" < worldarchitect-backup.sql
```

## Restore Drill

A backup is only useful if it restores.

At least once before a public beta:

1. Create a fresh temporary Postgres database.
2. Restore a backup into it:

   ```sh
   pg_restore --clean --if-exists --no-owner --dbname="$MIGRATION_DATABASE_URL" worldarchitect-backup.dump
   ```

3. Point a staging WorldArchitect deployment at that restored database.
4. Confirm login, world listing, article reads, snapshots, export, and provider settings masking.

## World ZIP Export

World ZIP export creates Markdown files for the current article content in a world.

It includes:

- Article title
- Category
- Status
- Template type
- Introduction
- Description
- Summary fallback from the World Bible entry

It does not include the full database. Do not rely on ZIP export as your only backup.

ZIP export may omit:

- Article version history
- Named snapshots
- Pending drafts
- Provider settings
- Call logs
- Usage and cost settings
- Coherence warnings
- Article and world issues
- Entity mentions and internal graph metadata
- User ownership and auth-related metadata

Use ZIP export for portable content and readable archives. Use Postgres backups for recovery.

## Provider Settings Location

Provider settings can come from two places:

- App-submitted provider keys are stored in Postgres in hosted mode and encrypted with `PROVIDER_SETTINGS_ENCRYPTION_KEY`.
- Environment overrides such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, and `OLLAMA_BASE_URL` live in the deployment environment and are not written back to Postgres.

Back up Postgres to preserve app-submitted provider settings. Back up or document your host environment variables separately.

## Updates

Before updating a self-hosted instance:

1. Read release notes.
2. Back up Postgres.
3. Deploy the new app version.
4. Check `/health`.
5. Run a small smoke test: login, create/edit an article, export, and provider settings mask check.

Keep `PROVIDER_SETTINGS_ENCRYPTION_KEY` stable across updates. Rotating it without a migration plan can make stored provider keys unreadable.

## Database Schema

On startup, the server creates `schema_migrations` if needed, applies any unapplied migration files in `server/src/db/migrations/postgres/`, and records each successful migration:

- `001_initial.sql`
- `002_full_schema.sql`
- `003_runs.sql`
- `004_call_log_instrumentation.sql`
- `005_search_index.sql`
- `006_row_level_security.sql`
- `007_llm_traces.sql`
- `008_run_review_items.sql`

If a migration fails, that migration transaction rolls back and the server does not record it as applied.

Hosted deployments should provide `MIGRATION_DATABASE_URL` for the owner/migration role and `DATABASE_URL` for the restricted runtime app role. The runtime role should have table/function grants but must be `NOSUPERUSER NOBYPASSRLS` so Postgres Row-Level Security remains effective.

WorldArchitect creates LangGraph-compatible checkpoint tables for Expand runs during migration. Those rows can contain resumable run state, so the app applies RLS to the checkpoint tables too and scopes them through the owning `runs` row. Expand review items are tenant-owned rows used when Manual or Assisted runs enter `needs_input`.

The helper script `ops/postgres/grant_runtime_role.sql` grants runtime privileges to an already-created restricted app role.

World ZIP export is a portable content export, not a full database backup. Use Postgres backups for hosted recovery.

## Security Checklist

- Do not commit `.env`, `.env.local`, database URLs, provider keys, Clerk secrets, or encryption keys.
- Use HTTPS in hosted mode.
- Use a strong `PROVIDER_SETTINGS_ENCRYPTION_KEY`; generate at least 32 random bytes, for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Keep `PROVIDER_SETTINGS_ENCRYPTION_KEY` stable across ordinary deploys and upgrades.
- Set `PUBLIC_BASE_URL` to the exact public `https://` origin users visit.
- Configure Clerk issuer and JWKS for the same Clerk application used by the frontend publishable key.
- Configure Clerk allowed origins/callbacks for the deployed domain.
- Treat `PUBLIC_BASE_URL` as the server CORS allow-origin value; if it is wrong, browsers should fail closed.
- Keep `ALLOW_DEV_AUTH_HEADER` unset in production.
- Use a restricted runtime Postgres role in `DATABASE_URL`; do not use a superuser or any role with `BYPASSRLS`.
- Use an owner/migration Postgres role only through `MIGRATION_DATABASE_URL` or an explicit migration release step.
- Run backups and restores with an owner, migration, or backup connection, not the restricted runtime URL.
- After deploy, smoke-test two real users: user A creates data, user B cannot list it, and direct user A IDs return `404`.
- Keep `TRUST_PROXY` correct for your host.
- Keep rate limiting enabled in hosted mode.
- Rotate provider keys if you suspect exposure.
- Rotate Clerk, database, and provider credentials if `.env.local`, deployment environment variables, logs, or backups are exposed.
- Review logs without pasting secrets into public issues.

## Troubleshooting Signals

- `AUTH_REQUIRED` or `AUTH_INVALID`: check Clerk issuer/JWKS/audience and frontend publishable key.
- CORS failure: check `PUBLIC_BASE_URL`.
- 500 on provider settings: check `PROVIDER_SETTINGS_ENCRYPTION_KEY`.
- Postgres connection errors: check `DATABASE_URL`, SSL mode, pooler URL, and `PGPOOL_MAX`.
- Rows appear missing in hosted mode: confirm the request/job has the expected tenant id, the runtime role has grants, and `DATABASE_URL` is the restricted app role rather than the owner/migration role. RLS should hide rows when `app.current_owner_id` is missing or wrong.
- All clients share a rate limit: check `TRUST_PROXY`.
- AI calls disabled unexpectedly: check `WORLDARCHITECT_LOCAL_ONLY` and provider settings.
