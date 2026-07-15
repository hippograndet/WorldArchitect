# Tech Stack

WorldArchitect is a two-process web app: a browser app and a server that owns everything else.

- **Frontend** - React with TypeScript, built with Vite, styled with Tailwind CSS. Article text is edited with a rich-text editor (TipTap) that reads and writes plain Markdown.
- **Backend** - Node.js with Express. The server owns the database, exports, provider settings, and AI calls; the browser never talks to any of those directly.
- **Database** - Postgres, run locally through Docker Compose. The same database engine is used in local mode and in hosted self-deployment.
- **AI orchestration** - LangGraph coordinates the multi-agent workflows described in [Multi-Agent System Overview](mas-overview.md).
- **AI providers** - Anthropic, OpenAI-compatible APIs (including Groq), and Ollama for a fully local model. AI is optional; the app works with no provider configured.
- **Authentication (hosted mode only)** - Clerk. Local mode has no accounts.
- **Export** - World content can be packaged as a ZIP of Markdown files.
- **Testing** - Vitest and Supertest cover the client and server.
- **Hosting** - Self-deployable via Docker; Render, Railway, and Fly.io are supported hosting paths (see [DEPLOY.md](../DEPLOY.md)).

This is the plain-language version. For exact package versions and source-of-truth file references, see the developer-only reference kept alongside the codebase.
