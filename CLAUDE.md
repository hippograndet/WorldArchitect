# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**WorldArchitect** — a local-first, single-user fiction world-building web app.
Users seed a world with descriptions and inspirations, then iteratively build a Wikipedia-style encyclopedia.
A Multi-Agent System (MAS) generates and expands content — but the entire app works without LLM calls; all manual editing, versioning, and data management is independent of AI.

Key docs:
- `docs/draft_spec.md` — full product specification (approved)
- `docs/draft_arch.md` — architecture decisions, schema, interfaces, API endpoints
- `docs/build_blocks.md` — 16 incremental build blocks with test checklists

---

## Build Status

| Block | Layer | Description | Status |
|---|---|---|---|
| 1 | Server | Monorepo + SQLite + health check | ✅ Done |
| 2 | Server | World & Category CRUD | ✅ Done |
| 3 | Server | Article CRUD + versioning + drafts | ✅ Done |
| 4 | Server | World Bible service + routes | ✅ Done |
| 5 | Server | Provider abstraction + call logger + settings | ✅ Done |
| 6 | Server | BaseAgent (tool-use loop) + SkeletonAgent | 🔲 Next |
| 7 | Server | ProposalAgent + ExpansionAgent | 🔲 Pending |
| 8 | Server | CoherenceAgent + HistoryAgent + CompressionAgent | 🔲 Pending |
| 9 | Server | Snapshots + ZIP export | 🔲 Pending |
| 10–16 | Client | Full React frontend | 🔲 Pending |

---

## Environment

### Hardware
- **Machine:** MacBook Pro 16,2 (2020) — Intel x86_64, NOT Apple Silicon
- **CPU:** Quad-Core Intel Core i5 @ 2 GHz, 8 logical cores
- **RAM:** 16 GB

### OS & Runtimes
| Tool | Version |
|------|---------|
| macOS | 26.4.1 (Darwin 25.4.0 x86_64) |
| Node.js | 20.19.1 (LTS) |
| npm | 10.8.2 |

**Not installed:** Docker, Rust, Java. TypeScript is per-project (installed in workspaces).
**Constraints:** No Apple Silicon, no Docker, no local GPU. Ollama is supported but not assumed to be running.

---

## Tech Stack

### Monorepo structure
```
WorldArchitect/
├── client/          # React 18 + Vite + TypeScript (Block 10+)
├── server/          # Node.js + Express + TypeScript
├── data/            # Runtime — worldarchitect.db (SQLite, WAL mode)
├── docs/
└── package.json     # npm workspaces root
```

Start both: `npm run dev` (uses `concurrently`)
Start server only: `npm run dev:server`

### Server stack
| Concern | Library |
|---|---|
| HTTP | Express 4 |
| Database | better-sqlite3 (WAL, foreign keys ON) |
| LLM: Anthropic | @anthropic-ai/sdk |
| LLM: OpenAI / Groq / Ollama | openai (custom baseURL) |
| Validation | zod |
| IDs | nanoid |
| Export | jszip |

### Client stack (Block 10+)
React 18, react-router-dom v6, Zustand + Immer, TipTap + markdown, Tailwind CSS + @tailwindcss/typography

---

## Server Source Layout

```
server/src/
├── db/
│   ├── index.ts          # getDb() singleton — WAL, FK, schema apply
│   └── schema.ts         # All CREATE TABLE IF NOT EXISTS + seed provider_settings
├── providers/
│   ├── types.ts          # LLMProvider interface, ChatMessage, CompletionResult, Tool types
│   ├── anthropic.ts      # AnthropicProvider — real count_tokens API
│   ├── openai.ts         # OpenAICompatibleProvider — covers OpenAI, Groq, Ollama
│   └── index.ts          # getProvider(), requireLLM middleware, maskKey(), readProviderSettings()
├── services/
│   ├── worldBible.ts     # upsertEntry(), renderBible(), getEntries(), getBibleMeta()
│   ├── callLogger.ts     # logCall(), checkDailyCap(), getDailyCallCount()
│   └── tokenEstimator.ts # estimateCallTokens(), updateBibleTokenCount()
├── routes/
│   ├── worlds.ts         # POST/GET/PATCH/DELETE /api/worlds[/:wid]
│   ├── categories.ts     # CRUD /api/worlds/:wid/categories[/:cid]
│   ├── articles.ts       # CRUD + versions + revert + drafts + accept
│   ├── bible.ts          # GET / | GET /render | PATCH /:aid
│   ├── settings.ts       # Global provider settings + worldSettingsRouter (per-world cost)
│   └── callLog.ts        # GET /api/worlds/:wid/call-log
└── index.ts              # Express app, CORS, route mounting
```

**To be created (Block 6+):**
```
server/src/
├── agents/
│   ├── base.ts           # BaseAgent — tool-use loop, logging, error handling
│   ├── skeleton.ts
│   ├── proposal.ts
│   ├── expansion.ts
│   ├── coherence.ts
│   ├── history.ts
│   └── compression.ts
├── tools/
│   ├── context.ts        # Read-only DB tools: getWorldBible, getArticle, searchArticles, getTimeline
│   └── output.ts         # Output tools: submitProposals, submitExpansion, submitCoherence, etc.
├── prompts/
│   ├── skeleton.ts
│   ├── proposal.ts
│   ├── expansion.ts
│   ├── coherence.ts
│   ├── history.ts
│   └── compression.ts
└── routes/
    ├── agents.ts         # All /api/worlds/:wid/agents/* endpoints
    ├── snapshots.ts
    └── export.ts
```

---

## Database Schema (12 tables + 1 global)

| Table | Purpose |
|---|---|
| `worlds` | World record (name, description, tone, tags, origin_point) |
| `categories` | Categories per world (sort_order, hidden) |
| `articles` | Articles (status, template_type, temporal_anchor, is_fixed_point) |
| `article_versions` | Full version history (body, summary, expansion_params, proposal_used, is_revert) |
| `article_links` | Cross-links between articles |
| `coherence_warnings` | Open/accepted/resolved warnings per article |
| `world_bible_entries` | One summary row per article (joined to render Bible) |
| `world_bible_meta` | Materialized token count per world |
| `world_snapshots` | Named world checkpoints (JSON dump) |
| `call_log` | Every LLM call (agent_type, tokens_in/out, status, error) |
| `pending_drafts` | Crash-recovery: selected proposal + draft content |
| `cost_settings` | Per-world: daily_cap, bible_threshold |
| `provider_settings` | **Global singleton**: active provider + config JSON (keys masked on read) |

All cascades use `ON DELETE CASCADE`. Foreign keys enforced at DB level (`PRAGMA foreign_keys = ON`).

---

## LLM Provider System

**Providers:** `anthropic` | `openai` | `groq` | `ollama` | `none`

- `getProvider()` — returns the active `LLMProvider`, throws with helpful message if `none`
- `requireLLM` — Express middleware returning `503` when no provider configured
- `maskKey(key)` — never returns raw API keys to the client
- Keys are stored in `provider_settings.config` (JSON), only updated when explicitly provided
- Switching providers preserves all other keys (easy to switch back)

**`LLMProvider` interface:**
```typescript
interface LLMProvider {
  name: ProviderName;
  complete(messages: ChatMessage[], options?: CompletionOptions, tools?: Tool[]): Promise<CompletionResult>;
  estimateTokens(text: string): Promise<number>;
}
```

Token counting: Anthropic uses the real `count_tokens` API. OpenAI-compatible providers use `chars / 4`.

---

## Agent Design (Block 6) — Tool-Use Pattern

Agents must NOT just request JSON via the prompt. They use the provider's native **tool/function calling** to interact with the world safely.

### Two categories of tools

**Context tools (read-only DB)** — agents call these to fetch data:
- `get_world_bible()` — returns rendered Bible markdown
- `get_article(articleId)` — returns article body + metadata
- `search_articles(query)` — keyword search over articles
- `get_timeline(worldId)` — articles with temporal anchors, sorted

**Output tools (structured result)** — one per agent; the agent calls this to submit its answer:
- `submit_proposals(proposals[3])` — ProposalAgent
- `submit_expansion(body, summary, coherenceWarnings[], suggestedLinks[], temporalAnchor?)` — ExpansionAgent
- `submit_coherence_check(warnings[], suggestedLinks[])` — CoherenceAgent
- `submit_stubs(stubs[])` — SkeletonAgent
- `submit_compression(compressedEntries[])` — CompressionAgent

### BaseAgent tool-use loop

```
1. Build initial messages (system prompt + user request)
2. Call provider.complete(messages, options, tools)
3. If stopReason = 'tool_use':
     a. For each tool call: validate input (Zod), execute, append result
     b. Loop back to step 2
4. If output tool was called: extract + return its input as the result
5. Log the call (agent_type, tokensIn, tokensOut, status)
```

### Safety rules
- Context tools are **read-only** — no DB writes inside the agent loop
- All tool inputs are validated with Zod before execution
- Max iterations cap (e.g. 5) prevents infinite loops
- If the agent hits max iterations without calling the output tool → error + log
- `requireLLM` middleware blocks all agent routes when no provider is set
- Daily cap is checked before each agent route executes (not inside the loop)

---

## Key API Endpoints (implemented)

```
GET    /health

POST   /api/worlds                         create world + 8 default categories
GET    /api/worlds                         list worlds
GET    /api/worlds/:wid                    get world
PATCH  /api/worlds/:wid                    update world
DELETE /api/worlds/:wid                    delete world

GET    /api/worlds/:wid/categories         list categories
POST   /api/worlds/:wid/categories         create category
PATCH  /api/worlds/:wid/categories/:cid   update category
DELETE /api/worlds/:wid/categories/:cid   delete category

GET    /api/worlds/:wid/articles           list (filter: category, status, q)
POST   /api/worlds/:wid/articles           create article manually
GET    /api/worlds/:wid/articles/:aid      article + current version + links + warnings
PATCH  /api/worlds/:wid/articles/:aid      manual edit → new version
DELETE /api/worlds/:wid/articles/:aid      delete

GET    /api/worlds/:wid/articles/:aid/versions        list version history
GET    /api/worlds/:wid/articles/:aid/versions/:vid   preview version
POST   /api/worlds/:wid/articles/:aid/revert/:vid     revert (non-destructive)

GET    /api/worlds/:wid/articles/:aid/draft    get pending draft (crash recovery)
POST   /api/worlds/:wid/articles/:aid/draft    save/update draft
DELETE /api/worlds/:wid/articles/:aid/draft    discard
POST   /api/worlds/:wid/articles/:aid/accept   commit draft → new version

GET    /api/worlds/:wid/bible              all Bible entries + token count
GET    /api/worlds/:wid/bible/render       full rendered markdown (LLM context)
PATCH  /api/worlds/:wid/bible/:aid         edit one article's summary

GET    /api/settings                       provider settings (keys masked)
PATCH  /api/settings                       set provider + API key
POST   /api/settings/test                  test active provider connection
GET    /api/settings/ollama/models         list local Ollama models

GET    /api/worlds/:wid/settings           per-world cost settings
PATCH  /api/worlds/:wid/settings           update daily cap / Bible threshold

GET    /api/worlds/:wid/call-log           paginated call log

-- To be implemented (Blocks 6–9):
POST   /api/worlds/:wid/agents/estimate
POST   /api/worlds/:wid/agents/skeleton
POST   /api/worlds/:wid/agents/propose
POST   /api/worlds/:wid/agents/expand
POST   /api/worlds/:wid/agents/cohere
POST   /api/worlds/:wid/agents/history
POST   /api/worlds/:wid/agents/compress
GET    /api/worlds/:wid/snapshots
POST   /api/worlds/:wid/snapshots
GET    /api/worlds/:wid/snapshots/:sid
POST   /api/worlds/:wid/snapshots/:sid/restore
DELETE /api/worlds/:wid/snapshots/:sid
GET    /api/worlds/:wid/export
```

---

## Allowed Tool Permissions

Pre-approved in `.claude/settings.local.json`:
- `npx tsc:*` — TypeScript type-checking
- `python3 -c` / `python3 *.py` — running Python scripts
- `ollama list *` — querying local Ollama models
- `mcp__context7__query-docs` — fetching library documentation via Context7
