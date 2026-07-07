# Deploy WorldArchitect

WorldArchitect defaults to local-first mode. Hosted mode is opt-in with `APP_MODE=hosted`.

This document is written for self-hosting. The recommended beta path is:

- Render for the app service
- Neon for managed Postgres
- Clerk for authentication

Railway and Fly.io are also supported deployment targets, but the Render + Neon + Clerk path is the first one to test from a clean checkout for the self-hosted beta.

## Required Environment

- `APP_MODE=hosted`
- `STORAGE_DRIVER=postgres`
- `DATABASE_URL=postgres://...`
- `PUBLIC_BASE_URL=https://your-domain.example`
- `PROVIDER_SETTINGS_ENCRYPTION_KEY=<long random secret>`
- `CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json`
- `CLERK_ISSUER=https://<your-clerk-domain>`
- `CLERK_AUDIENCE=<optional audience>`
- `VITE_CLERK_PUBLISHABLE_KEY=pk_...` (client build-time variable)
- Optional provider env overrides: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`

For local hosted-mode smoke tests only, set `ALLOW_DEV_AUTH_HEADER=1` and send `x-worldarchitect-user-id`.

## Pool Sizing

`PGPOOL_MAX` (default `5`) caps how many Postgres connections each server process opens. Keep `PGPOOL_MAX ≤ (Neon plan's pooled connection limit) ÷ (max concurrent server instances)` — e.g. if your Neon plan's pooler allows 100 and you run 3 instances, `PGPOOL_MAX=30` is safe; the conservative default of 5 is fine for a single instance. Also configurable: `PGPOOL_IDLE_TIMEOUT_MS` (default `30000`), `PGPOOL_CONN_TIMEOUT_MS` (default `5000`).

## Rate Limiting And Proxy Trust

`/api/*` is rate-limited in hosted mode only (local mode is never throttled). Tunable via `RATE_LIMIT_WINDOW_MS` (default `60000`) and `RATE_LIMIT_MAX` (default `300`, requests per window per client). `TRUST_PROXY` (default `1`) controls Express's `trust proxy` setting, which must correctly reflect your deployment's reverse-proxy hop count (Render/Fly/Railway all sit in front of the app) for rate limiting to key on the real client IP instead of the proxy's.

## Client environment

The frontend needs its own Clerk key to render the sign-in screen (separate from the server's `CLERK_*` vars above, and read at build time by Vite):

- `VITE_CLERK_PUBLISHABLE_KEY=pk_...` — from the same Clerk Dashboard "API Keys" page as `CLERK_ISSUER`/`CLERK_JWKS_URL`. Leave unset for local mode (no login).

## Render + Neon + Clerk

Use this path for the first self-hosted beta deployment.

### 1. Create Neon Postgres

1. Create a Neon project.
2. Copy the pooled connection string.
3. Use the pooled URL as `DATABASE_URL`.
4. Keep the database region near your app host region.

Use a pooled connection string when possible. Keep `PGPOOL_MAX` conservative for small plans; the default `5` is a good first value for one Render instance.

### 2. Create Clerk Auth

1. Create a Clerk application.
2. Copy the publishable key to `VITE_CLERK_PUBLISHABLE_KEY`.
3. Copy the issuer URL to `CLERK_ISSUER`.
4. Set `CLERK_JWKS_URL` to the issuer plus `/.well-known/jwks.json`.
5. Add the final Render URL or custom domain to the allowed origins/callback settings in Clerk.

If you later change domains, update both Clerk and `PUBLIC_BASE_URL`.

### 3. Create The Render Web Service

Create a Render Web Service from the repository.

Recommended settings:

- Runtime: Node
- Build command: `npm ci && npm run build`
- Start command: `npm start -w server`
- Health check path: `/health`

This single-service setup serves the API and the built React client from the same Render service. That requires `STATIC_DIR=client/dist`.

Set these environment variables in Render:

```sh
APP_MODE=hosted
STORAGE_DRIVER=postgres
DATABASE_URL=postgres://...
PUBLIC_BASE_URL=https://your-render-or-custom-domain.example
STATIC_DIR=client/dist
PROVIDER_SETTINGS_ENCRYPTION_KEY=<64-hex-character-random-secret>
CLERK_ISSUER=https://<your-instance>.clerk.accounts.dev
CLERK_JWKS_URL=https://<your-instance>.clerk.accounts.dev/.well-known/jwks.json
VITE_CLERK_PUBLISHABLE_KEY=pk_...
TRUST_PROXY=1
PGPOOL_MAX=5
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
```

Generate the encryption key locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not commit this value.

### 4. Verify The Deployment

After Render deploys:

1. Visit `/health`.
2. Confirm `status: ok`, `mode: hosted`, and `storage.driver: postgres`.
3. Sign in with Clerk.
4. Create a test world.
5. Save and reload a provider setting; confirm the key is masked.
6. Create, edit, snapshot, export, and delete a world.
7. Sign in with a second Clerk user and confirm the first user's world is not visible.

## Docker

For ordinary local development, use Postgres with local app mode:

```sh
npm run dev
```

That command starts the `postgres` service from `docker-compose.yml` and runs the server with `APP_MODE=local`, `STORAGE_DRIVER=postgres`, and the local compose database URL.

Build and run:

```sh
docker build -t worldarchitect .
docker run --rm -p 3001:3001 --env APP_MODE=local worldarchitect
```

Hosted-mode local Postgres smoke test:

```sh
docker compose up --build
curl http://localhost:3001/health
```

## Railway

1. Create a Railway project from this repository.
2. Add a Postgres service and copy its connection string to `DATABASE_URL`.
3. Set the required environment variables above.
4. Railway will build with `railway.toml` and use `/health`.
5. Add your custom domain in Railway, then create the DNS record Railway shows.

## Fly.io

1. Create a Fly app and Postgres cluster.
2. Set secrets:

```sh
fly secrets set APP_MODE=hosted STORAGE_DRIVER=postgres DATABASE_URL='postgres://...' \
  PUBLIC_BASE_URL='https://worldarchitect.example' \
  PROVIDER_SETTINGS_ENCRYPTION_KEY='replace-with-random-secret' \
  CLERK_JWKS_URL='https://example.clerk.accounts.dev/.well-known/jwks.json' \
  CLERK_ISSUER='https://example.clerk.accounts.dev'
```

3. Deploy with `fly deploy`.

## DNS and TLS

Use the host's custom-domain flow. For Railway, add the generated `CNAME` or `A/AAAA` records at your DNS provider. For Fly.io, run `fly certs add your-domain.example`, then add the shown `A/AAAA` records. Both platforms provision HTTPS certificates automatically after DNS validates.

Set `PUBLIC_BASE_URL` to the final `https://` origin so CORS allows the browser app.

## Updating A Self-Hosted Install

Before updating:

1. Back up Postgres.
2. Read the release notes for migration notes.
3. Deploy the new version.
4. Check `/health`.
5. Run the manual QA checklist below.

Do not rotate `PROVIDER_SETTINGS_ENCRYPTION_KEY` during an ordinary update. Stored provider keys are encrypted with it.

## Backup And Restore

For hosted mode, Postgres is the system of record. Configure managed backups in Neon, Railway, Fly.io, or your chosen database host. A world ZIP export is useful, but it is not a full backup.

Before major upgrades, create a manual backup from your database provider. A basic custom-format `pg_dump` backup looks like:

```sh
pg_dump --format=custom --file=worldarchitect-backup.dump "$DATABASE_URL"
```

Restore into a fresh empty database with:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" worldarchitect-backup.dump
```

If your host only supports SQL-format backups, `pg_dump "$DATABASE_URL" > worldarchitect-backup.sql` and `psql "$DATABASE_URL" < worldarchitect-backup.sql` also work, but custom-format backups are easier to restore selectively.

World ZIP export downloads Markdown files for a world's current articles. It includes article title, category, status, template type, temporal anchor, introduction, description, chronology, and summary fallback. It does not replace Postgres backups because it does not include the full database: article version history, snapshots, pending drafts, provider settings, call logs, usage/cost settings, issues, warnings, user ownership rows, and other internal metadata may be absent.

Provider settings live in the database. User-entered provider keys are stored encrypted with `PROVIDER_SETTINGS_ENCRYPTION_KEY`; environment-provided keys such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, and `OLLAMA_BASE_URL` live only in the deployment environment and are not written back to Postgres.

## Troubleshooting

- `/health` fails: verify `APP_MODE`, `STORAGE_DRIVER`, `DATABASE_URL`, and database network access.
- Sign-in screen does not load: verify `VITE_CLERK_PUBLISHABLE_KEY` was present at build time.
- API returns auth errors: verify `CLERK_ISSUER`, `CLERK_JWKS_URL`, Clerk allowed origins, and the browser domain.
- Browser CORS errors: verify `PUBLIC_BASE_URL` exactly matches the deployed `https://` origin.
- Provider key cannot be saved: verify `PROVIDER_SETTINGS_ENCRYPTION_KEY` is set and stable.
- Provider calls fail: verify the selected provider, API key source, daily cap, and local-only mode.
- Rate limits look wrong: verify `TRUST_PROXY` for your host so client IPs are detected correctly.
- Database pool errors: lower `PGPOOL_MAX` or use a pooled Neon connection string.

## Manual QA

- Visit `/health` and confirm `status: ok`, `mode: hosted`, and `storage.driver: postgres`.
- Sign in as user A, create a world, and confirm it appears in the worlds list.
- Sign in as user B and confirm user A's world is absent and direct URLs return 404.
- Save a provider API key, refresh settings, and confirm only a masked key is returned.
- Run an AI settings test with the configured provider.
- Create, edit, snapshot, export, and delete a world.
