# Security Notes

WorldArchitect is local-first and single-user by design in its default mode (`APP_MODE=local`): no account system, no hosted sync layer. The sections below describe that default.

WorldArchitect also supports an opt-in hosted mode (`APP_MODE=hosted`) for self-deployment, which adds Clerk-based authentication and per-user data isolation over Postgres. See [DEPLOY.md](../DEPLOY.md) for hosted-mode setup and required secrets.

## Hosted-Mode API Hardening

- Bearer tokens are verified against Clerk's JWKS using the `jose` library, with an explicit signing-algorithm allowlist.
- All API responses carry standard security headers (`helmet`).
- `/api/*` is rate-limited in hosted mode; local mode (a single trusted user) is never throttled.
- Every request is assigned a correlation id, returned as `X-Request-Id` and included in every related server log line, so a reported issue can be traced through the logs.

## Provider Secrets

- Users can enter provider keys in the app Settings screen.
- Keys are stored in the local SQLite database and are returned to the client only as masked values.
- Environment variables can override stored keys for operator workflows, but env keys are not persisted.
- Startup scans tracked project files for obvious committed provider keys and fails loudly if one is found.

## Data Egress

AI features are optional. Hosted LLM providers may receive relevant world context only when configured and invoked.

Local-only mode blocks Anthropic, OpenAI, and Groq provider calls and permits only Ollama. `WORLDARCHITECT_LOCAL_ONLY=1` forces that mode regardless of app settings.

## Prompt And Output Safety

World/article/user content is wrapped as untrusted data in prompts and context-tool responses. Agent output is zod-validated before generated drafts, links, warnings, or mentions can mutate the database.

## Observability

Logs are structured JSON, redact API-key-shaped values, and include a request correlation id and user id where available. `SENTRY_DSN` enables a Sentry-compatible error hook; without a DSN it is a no-op.
