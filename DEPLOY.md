# Deploy WorldArchitect

WorldArchitect defaults to local-first mode. Hosted mode is opt-in with `APP_MODE=hosted`.

## Required Environment

- `APP_MODE=hosted`
- `STORAGE_DRIVER=postgres`
- `DATABASE_URL=postgres://...`
- `PUBLIC_BASE_URL=https://your-domain.example`
- `PROVIDER_SETTINGS_ENCRYPTION_KEY=<long random secret>`
- `CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json`
- `CLERK_ISSUER=https://<your-clerk-domain>`
- `CLERK_AUDIENCE=<optional audience>`
- Optional provider env overrides: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`

For local hosted-mode smoke tests only, set `ALLOW_DEV_AUTH_HEADER=1` and send `x-worldarchitect-user-id`.

## Docker

Build and run:

```sh
docker build -t worldarchitect .
docker run --rm -p 3001:3001 --env APP_MODE=local worldarchitect
```

Hosted-mode local Postgres:

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

## Manual QA

- Visit `/health` and confirm `status: ok`, `mode: hosted`, and `storage.driver: postgres`.
- Sign in as user A, create a world, and confirm it appears in the worlds list.
- Sign in as user B and confirm user A's world is absent and direct URLs return 404.
- Save a provider API key, refresh settings, and confirm only a masked key is returned.
- Run an AI settings test with the configured provider.
- Create, edit, snapshot, export, and delete a world.
