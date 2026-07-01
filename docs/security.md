# Security Notes

WorldArchitect is local-first and single-user by design. It has no account system and no hosted sync layer.

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

Logs are structured JSON and redact API-key-shaped values. `SENTRY_DSN` enables a Sentry-compatible error hook; without a DSN it is a no-op.
