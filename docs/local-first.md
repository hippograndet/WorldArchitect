# Local-First Data And Privacy

WorldArchitect is designed as a local-first desktop-style web app. You run it yourself, and the project data lives on your machine.

This page describes the default **local mode** (`APP_MODE=local`). WorldArchitect also supports an opt-in **hosted mode** for self-deployment, which adds accounts (Clerk) and scopes data per user instead of per machine — see [DEPLOY.md](../DEPLOY.md) for that setup. Everything below assumes local mode.

## What Is Stored Locally

World data is stored in a local Postgres database managed through Docker Compose and owned by the server process. SQLite is still available as a temporary legacy fallback, but Postgres is the preferred local database. Stored data includes:

- Worlds
- Categories
- Articles
- Article versions
- World Bible summaries
- Snapshots
- Pending drafts
- Provider settings
- Call logs
- Issues and warnings

The app does not require accounts or hosted cloud storage.

## What Uses The Network

Normal editing, browsing, versioning, snapshots, and export do not require an LLM provider.

Network calls happen only when you configure a provider and run an AI-powered tool. Depending on your provider, the app may send relevant prompts, article summaries, context, and draft content to that provider.

Local-only mode can be enabled in Settings. When it is on, AI features are restricted to Ollama and hosted providers are blocked. Operators can force this mode with `WORLDARCHITECT_LOCAL_ONLY=1`; when forced, the app cannot disable it.

## API Keys

Provider keys can be entered in the app Settings screen and are stored locally by the app. They are masked when returned to the client interface.

Advanced users can override stored keys at runtime with environment variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `OLLAMA_BASE_URL`

Environment values take precedence but are never written back to the database. Settings show whether a key comes from the app, the environment, or is unset.

You should still treat your local database and environment as sensitive, because provider credentials and private world material may be present on your machine.

## AI Safety Controls

WorldArchitect treats world articles, drafts, and retrieved context as untrusted data when building prompts. Generated agent output is validated before it can update the database.

Provider calls have request timeouts, retry limits, and token ceilings. Failures return clear errors instead of crashing the server. Logs redact API-key-shaped values before writing messages.

## Export

WorldArchitect can export a world as a ZIP of Markdown files. This gives you a portable copy that can be backed up, versioned elsewhere, or read without the app.

## Practical Privacy Model

WorldArchitect is a good fit if you want:

- No account system
- Local persistence
- Optional AI instead of mandatory AI
- Control over when world content leaves your machine
- A straightforward path to export your work

It is not a hosted collaboration platform, and it does not provide built-in cloud sync.
