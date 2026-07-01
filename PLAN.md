# WorldArchitect LLM Trust Hardening Plan

## Repo Map

- `server/src/providers/` owns provider selection, API-key config, and the Anthropic/OpenAI-compatible adapters.
- `server/src/routes/settings.ts` exposes global provider settings and per-world cost settings.
- `server/src/services/callLogger.ts` records LLM usage and enforces per-world daily caps.
- `server/src/agents/base.ts` runs the shared tool-use loop and validates agent output through each agent's zod parser.
- `server/src/prompts/` builds system and user prompts; world/article content enters agent calls here.
- `server/src/tools/context.ts` returns retrieved world/article content to agents.
- `server/src/routes/articles.ts` accepts generated drafts and mutates article/version/link/mention tables.
- `client/src/components/world/WorldSettings.tsx` and `client/src/lib/api.ts` are the app-facing provider settings surface.

## Implementation Sequence

1. Preserve the in-app API key setup flow, then add env overrides, key source metadata, redaction, and a startup leak scan.
2. Wrap untrusted world/article/user/draft content in clear prompt data boundaries and validate generated payloads again before DB writes.
3. Add local-only egress control as both an app setting and an env lock, allowing only Ollama when enabled.
4. Add provider request timeouts, retry-with-backoff, and hard per-request token ceilings with typed graceful errors.
5. Add structured logging, a no-op-unless-configured Sentry-compatible hook, CI workflow, and docs.

## Commit Plan

- Commit 1: this `PLAN.md`.
- Commit 2: secret handling, env override, redaction, startup scan, tests.
- Commit 3: prompt boundaries, persistence validation, malicious-content tests.
- Commit 4: local-only egress mode and tests.
- Commit 5: timeout/retry/budget ceilings and tests.
- Commit 6: CI, logging, Sentry hook, docs.
