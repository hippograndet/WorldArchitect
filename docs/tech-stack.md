# Tech Stack

This document defines the current WorldArchitect technology stack. Versions are taken from the installed workspace dependency graph and local runtime configuration, with deployment notes cross-checked against `DEPLOY.md`, `Dockerfile`, and `docker-compose.yml`.

| Layer | Technology | Version | Notes |
| --- | --- | --- | --- |
| Application architecture | Two-process web app | 0.5.0 app version | `client/` is the browser app; `server/` owns persistence, exports, provider settings, AI calls, and versioning. |
| Frontend framework | React | 18.3.1 | Browser UI runtime. |
| Frontend build tool | Vite | 6.4.2 | Used for local dev, production client builds, and preview. |
| Frontend language | TypeScript | 5.9.3 installed, `^5.4.5` declared in client | Client source is TypeScript/TSX. |
| Routing | React Router DOM | 6.30.3 | Client-side page routing. |
| State management | Zustand | 5.0.12 | Main client state store. |
| Immutable updates | Immer | 10.2.0 | Used alongside client state updates. |
| Styling | Tailwind CSS | 4.2.4 | Primary styling system. |
| Typography styling | `@tailwindcss/typography` | 0.5.19 | Prose/content styling support. |
| Tailwind/Vite integration | `@tailwindcss/vite` | 4.2.4 | Tailwind integration for the Vite client. |
| Rich text editor | TipTap React, TipTap Starter Kit | 2.27.2 | Used by article description and chronology editors. |
| Rich text serialization | `tiptap-markdown` | 0.8.10 | Converts TipTap editor content to Markdown. |
| Icons | `lucide-react` | 1.14.0 | Icon library used in the React UI. |
| CMS | None | N/A | World content is first-party application data stored in Postgres, not managed by an external CMS. |
| Backend framework | Express | 4.22.1 | Server API framework. |
| Backend runtime | Node.js | 22 in Docker image | Runtime image is `node:22-bookworm-slim`. |
| Backend language | TypeScript | 5.9.3 installed, `^5.8.3` declared in server | Server source builds to `dist/` before production start. |
| Development runner | `tsx` | 4.21.0 | Runs the TypeScript server in watch mode during development. |
| Database | Postgres | 16-alpine locally | Local database is the `postgres:16-alpine` Docker Compose service. Hosted mode also uses Postgres. |
| Database driver | `pg` | 8.22.0 | Server-side Postgres client. |
| Database migrations | Internal SQL migrations | N/A | Migrations live under `server/src/db/migrations/postgres/`. |
| Database tenant isolation | Postgres Row-Level Security | Postgres policy feature | Hosted mode uses application ownership checks plus RLS policies keyed by `app.current_owner_id`. |
| Search | Postgres full-text search | Postgres 16 local runtime | Search index is maintained in Postgres. |
| Authentication | Clerk | `@clerk/react` 6.11.3 | Hosted mode uses Clerk; local mode is unauthenticated with a single implicit user. |
| JWT/JWKS validation | `jose` | 6.2.3 | Server-side hosted auth token verification. |
| Validation | Zod | 3.25.76 | Runtime schema validation for API and agent outputs. |
| AI orchestration | LangGraph | `@langchain/langgraph` 1.4.7 | Used for multi-agent graph workflows. |
| AI checkpointing | LangGraph Postgres checkpointing | 1.0.4 | Reuses the app's Postgres pool for checkpoints. |
| AI provider SDK | Anthropic SDK | 0.39.0 | One supported hosted LLM provider adapter. |
| AI provider SDK | OpenAI SDK | 4.104.0 | One supported hosted LLM provider adapter. |
| Local AI provider | Ollama | External service | Configured through `OLLAMA_BASE_URL`; no npm package is required. |
| Security middleware | Helmet | 8.2.0 | Adds HTTP security headers. |
| Rate limiting | `express-rate-limit` | 8.5.2 | Applies to `/api/*` in hosted mode. |
| ID generation | Nano ID | 5.1.9 | Used for generated identifiers. |
| Export packaging | JSZip | 3.10.1 | Builds downloadable world ZIP exports. |
| Testing | Vitest | 4.1.5 | Test runner for client and server. |
| API testing | Supertest | 7.2.2 | Server route testing. |
| Package manager | npm workspaces | npm lockfile v3 | Root workspace manages `client` and `server`. |
| Local development database | Docker Compose | Compose file versionless format | `npm run dev` starts Postgres and both app processes. |
| Containerization | Docker | Node 22 base image | Production container builds client and server, then serves the built client from the Express service. |
| Recommended hosting | Render + Neon + Clerk | External services | Recommended beta self-host path: Render app service, Neon managed Postgres, Clerk auth. |
| Supported hosting | Railway, Fly.io | External services | Config files are present for Railway and Fly.io; both expect `/health`. |
| Health checks | Express `/health` endpoint | N/A | Used by Docker, Render, Railway, and Fly.io deployment checks. |

## Source Documents

- `README.md` defines the client/server split and local-first defaults.
- `client/package.json`, `server/package.json`, and `package-lock.json` define dependency versions.
- `docker-compose.yml` defines the local Postgres runtime.
- `server/src/db/migrations/postgres/006_row_level_security.sql` defines database-level tenant policies.
- `server/src/agents/checkpointer.ts` applies tenant context and RLS to LangGraph checkpoint tables.
- `Dockerfile` defines the production Node runtime and container build.
- `DEPLOY.md`, `railway.toml`, and `fly.toml` define supported hosted deployment paths.
