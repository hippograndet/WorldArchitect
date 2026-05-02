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

All 16 blocks complete. The app is fully functional.

| Block | Layer | Description | Status |
|---|---|---|---|
| 1 | Server | Monorepo + SQLite + health check | ✅ Done |
| 2 | Server | World & Category CRUD | ✅ Done |
| 3 | Server | Article CRUD + versioning + drafts | ✅ Done |
| 4 | Server | World Bible service + routes | ✅ Done |
| 5 | Server | Provider abstraction + call logger + settings | ✅ Done |
| 6 | Server | BaseAgent (tool-use loop) + SkeletonAgent + document model | ✅ Done |
| 7 | Server | Full expansion pipeline (ProposalAgent, ExpanderAgent, SummarizerAgent, ChildProposerAgent, CoherenceAgent, RetentionAgent) | ✅ Done |
| 8 | Server | ChroniclerAgent + BibleCompressorAgent | ✅ Done |
| 9 | Server | Snapshots + ZIP export | ✅ Done |
| 10 | Client | React scaffolding + routing + types + API layer | ✅ Done |
| 11 | Client | World creation wizard + encyclopedia browser + AppShell | ✅ Done |
| 12 | Client | TipTap editor (Description) + Version history panel | ✅ Done |
| 13 | Client | AI Agent Panel (optional right-side drawer) + manual subsection creation + draft crash recovery | ✅ Done |
| 14 | Client | Manual Chronology editor (TipTap) + Timeline page | ✅ Done |
| 15 | Client | World Bible editor + BibleCompressor UI + Usage panel + CoherenceWarningBanner | ✅ Done |
| 16 | Client | Snapshots UI + Export + TopBar nav + Sidebar "New Article" + ConfirmDialog polish | ✅ Done |

---

## UX Philosophy

**Manual-first**: every action works without AI. Users can build an entire world by hand.

**AI is optional and explicit**: a persistent "AI Agent" button on each article page opens a right-side panel (`AgentPanel`). The panel is never forced; it gives full control over task, parameters (word count, detail depth, breadth, user spec/constraints), and target article.

**Document layers per article** (in order, each independently editable):
1. Introduction (1-paragraph summary, editable textarea) — stored in `world_bible_entries.summary`
2. Description (3–5 paragraphs, TipTap editor) — `## Description` section of article body
3. Subjects (child articles, manual "Add Subsection" + AI "Propose Children")
4. Chronology (events, TipTap editor) — `## Chronology` section of article body

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
├── client/          # React 18 + Vite + TypeScript
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

### Client stack
React 18, react-router-dom v6, Zustand + Immer, TipTap + tiptap-markdown, Tailwind CSS + @tailwindcss/typography

---

## Server Source Layout

```
server/src/
├── db/
│   ├── index.ts              # getDb() singleton — WAL, FK, schema apply
│   └── schema.ts             # All CREATE TABLE IF NOT EXISTS + seed provider_settings
├── providers/
│   ├── types.ts              # LLMProvider interface, ChatMessage, CompletionResult, Tool types
│   ├── anthropic.ts          # AnthropicProvider — real count_tokens API
│   ├── openai.ts             # OpenAICompatibleProvider — covers OpenAI, Groq, Ollama
│   └── index.ts              # getProvider(), requireLLM middleware, maskKey(), readProviderSettings()
├── services/
│   ├── worldBible.ts         # upsertEntry(), renderBible(), getEntries(), getBibleMeta()
│   ├── callLogger.ts         # logCall(), checkDailyCap(), getDailyCallCount()
│   ├── tokenEstimator.ts     # estimateCallTokens(), updateBibleTokenCount()
│   ├── sections.ts           # splitSections(body), mergeSections(description, chronology)
│   ├── archivist.ts          # buildContextPackage() — tiered context assembly for agents
│   └── exporter.ts           # buildWorldZip(worldId) → JSZip Buffer
├── agents/
│   ├── base.ts               # BaseAgent — tool-use loop (max 6 iter), Zod validation, call logging
│   ├── skeleton.ts           # SkeletonAgent — generates initial article stubs
│   ├── proposal.ts           # ProposalAgent — 3 creative direction proposals
│   ├── expander.ts           # ExpanderAgent — writes Description (4 modes)
│   ├── summarizer.ts         # SummarizerAgent — derives Introduction from Description
│   ├── childProposer.ts      # ChildProposerAgent — 10 child stub proposals
│   ├── coherence.ts          # CoherenceAgent — detects contradictions
│   ├── retention.ts          # RetentionAgent — verifies fact preservation (reorganize)
│   ├── chronicler.ts         # ChroniclerAgent — writes Chronology section
│   ├── bibleCompressor.ts    # BibleCompressorAgent — bulk-compresses Bible entries (preview only)
│   └── director.ts           # (orchestration helper)
├── tools/
│   ├── context.ts            # Read-only DB tools: get_world_bible, get_article, search_articles, get_timeline
│   ├── output.ts             # Output tool definitions: submit_stubs, submit_proposals, submit_expansion, etc.
│   └── types.ts              # Shared tool types
├── prompts/
│   ├── skeleton.ts, proposal.ts, expander.ts, summarizer.ts
│   ├── childProposer.ts, coherence.ts, retention.ts
│   ├── chronicler.ts, bibleCompressor.ts
│   └── (one file per agent)
├── routes/
│   ├── worlds.ts             # POST/GET/PATCH/DELETE /api/worlds[/:wid]
│   ├── categories.ts         # CRUD /api/worlds/:wid/categories[/:cid]
│   ├── articles.ts           # CRUD + versions + revert + drafts + accept + batch
│   ├── bible.ts              # GET / | GET /render | PATCH /:aid
│   ├── settings.ts           # Global provider settings + worldSettingsRouter (per-world cost)
│   ├── callLog.ts            # GET /api/worlds/:wid/call-log
│   ├── agents.ts             # All /api/worlds/:wid/agents/* endpoints
│   ├── snapshots.ts          # GET/POST/DELETE snapshots + POST restore
│   └── export.ts             # GET /api/worlds/:wid/export (streams ZIP)
└── index.ts                  # Express app, CORS, route mounting
```

---

## Client Source Layout

```
client/src/
├── main.tsx, App.tsx, routes.tsx, index.css
├── types/
│   ├── world.ts              # World, Category, BibleEntry, BibleMeta
│   ├── article.ts            # Article, ArticleVersion, ArticleDetail, PendingDraft, DraftContent, CoherenceWarning
│   └── agent.ts              # ExpansionParams, Proposal, ChildProposal, TokenEstimate
├── lib/
│   ├── api.ts                # Typed fetch wrappers for all server endpoints
│   ├── sections.ts           # extractDescription/Chronology, mergeDescription/Chronology
│   └── tree.ts               # buildTree() — flat article list → TreeNode[]
├── stores/
│   ├── index.ts              # useStore — combines all slices via Zustand + Immer
│   ├── worldSlice.ts         # worlds, categories, bibleEntries, bibleTokenCount/Threshold
│   ├── articleSlice.ts       # articles, treeNodes, currentArticleDetail, pendingDraft
│   ├── uiSlice.ts            # toasts, confirmDialog (with variant), sidebarOpen, searchQuery
│   └── agentSlice.ts         # AI agent state machine (phase, pipeline, params, proposals, draftResult)
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx      # Main layout — TopBar + Sidebar + Outlet + ConfirmDialog + AgentPanel
│   │   ├── TopBar.tsx        # World name + Timeline/Bible/Usage nav + Export + Snapshots + Settings
│   │   ├── Sidebar.tsx       # Article tree with search + "+ New Article" inline form
│   │   └── WorldBibleMeter.tsx  # Token usage progress bar
│   ├── world/
│   │   ├── WorldList.tsx     # Home page — list worlds
│   │   ├── WorldCreationWizard.tsx  # Create world form
│   │   └── WorldSettings.tsx  # World metadata + delete
│   ├── article/
│   │   ├── ArticlePage.tsx          # Main article view — all 4 document layers, History + AI Agent buttons
│   │   ├── InlineDescriptionEditor.tsx  # TipTap editor for Description
│   │   ├── ChronologyEditor.tsx     # TipTap editor for Chronology (manual path)
│   │   ├── VersionHistoryPanel.tsx  # Version list, preview, revert
│   │   ├── AddSubsectionDialog.tsx  # Manual child article creation modal
│   │   ├── DraftCrashRecovery.tsx   # Amber banner for leftover AI drafts
│   │   └── CoherenceWarningBanner.tsx  # Warnings display with dismiss
│   ├── agent/
│   │   ├── AgentPanel.tsx           # Fixed right-side drawer (z-50), no backdrop
│   │   ├── AgentConfigView.tsx      # Task selector + full parameter controls
│   │   ├── AgentLoadingView.tsx     # Spinner with phase label
│   │   ├── ProposalSelectorView.tsx  # 3 proposal cards (pick one → expand)
│   │   ├── ChildProposalSelectorView.tsx  # 10 child stubs (checkbox → batch create)
│   │   ├── DraftReviewView.tsx      # Draft content preview + Accept/Discard
│   │   └── AgentErrorView.tsx       # Error message + Retry
│   ├── bible/
│   │   └── BibleCompressorModal.tsx  # Preview compression, apply selected entries
│   └── shared/
│       ├── Toast.tsx, ConfirmDialog.tsx  # Global overlays (ConfirmDialog supports danger/neutral variant)
│       └── StatusBadge.tsx
└── pages/
    ├── WorldOverviewPage.tsx  # World dashboard — stats, section links
    ├── TimelinePage.tsx       # Sorted timeline with temporal anchors + Undated section
    ├── BiblePage.tsx          # Inline-editable Bible entries grouped by category
    ├── SnapshotsPage.tsx      # Create/restore/delete snapshots
    └── UsagePage.tsx          # Call log table + daily cap / Bible threshold settings
```

---

## Database Schema (13 tables)

| Table | Purpose |
|---|---|
| `worlds` | World record (name, description, tone, tags, origin_point) |
| `categories` | Categories per world (sort_order, hidden) |
| `articles` | Articles (status, template_type, temporal_anchor, is_fixed_point, depth) |
| `article_versions` | Full version history (body, summary, expansion_params, proposal_used, is_revert) |
| `article_links` | Cross-links between articles (hierarchical parent→child + cross-refs) |
| `coherence_warnings` | Open/accepted/resolved warnings per article |
| `world_bible_entries` | One summary row per article (joined to render Bible) |
| `world_bible_meta` | Materialized token count per world |
| `world_snapshots` | Named world checkpoints (full JSON dump) |
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
- Switching providers preserves other providers' stored keys

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

## Agent Design — Tool-Use Pattern

Agents use the provider's native **tool/function calling** — not JSON-in-prompt. See `server/src/agents/base.ts`.

### Two categories of tools

**Context tools (read-only DB)** — `server/src/tools/context.ts`:
- `get_world_bible()` — rendered Bible markdown
- `get_article(articleId)` — article body + metadata
- `search_articles(query)` — keyword search
- `get_timeline(worldId)` — articles with temporal anchors, sorted

**Output tools (structured result)** — `server/src/tools/output.ts`:
- `submit_stubs`, `submit_proposals`, `submit_description`, `submit_child_description`
- `submit_introduction`, `submit_child_proposals`, `submit_chronology`
- `submit_coherence_check`, `submit_retention_check`, `submit_compression`

### BaseAgent tool-use loop (`server/src/agents/base.ts`)
1. Build initial messages (system prompt + user request)
2. Call `provider.complete(messages, options, tools)`
3. If `stopReason = 'tool_use'`: validate with Zod, execute, append result, loop
4. If output tool was called: extract result, log call, return
5. Max 6 iterations — exceeding this → error + log

### Agent pipelines (all via `POST /api/worlds/:wid/agents/...`)
| Route | Pipeline |
|---|---|
| `/estimate` | Token estimate (no LLM call) |
| `/skeleton` | SkeletonAgent → bulk create initial stubs |
| `/propose` | ProposalAgent → 3 proposals |
| `/expand` | ExpanderAgent → Description + SummarizerAgent → Introduction + CoherenceAgent |
| `/propose-children` | ChildProposerAgent → 10 child stub proposals |
| `/summarize` | SummarizerAgent only (standalone) |
| `/reorganize` | ExpanderAgent [reorganize] → RetentionAgent → SummarizerAgent |
| `/cohere` | CoherenceAgent only (standalone) |
| `/chronology` | ChroniclerAgent → CoherenceAgent |
| `/compress` | BibleCompressorAgent (preview only — apply via PATCH /bible/:aid) |

### Pipeline types (pipelineType field)
`expand_description` | `create_root` | `create_child` | `reorganize` | `expand_chronology`

Pipelines that use `pending_drafts` (crash-recoverable): `expand_description`, `create_child`, `expand_chronology`, `reorganize`.

---

## Client AI Agent Panel (agentSlice.ts)

The panel is a right-side fixed drawer, opened by "AI Agent" button on ArticlePage. Never forced; fully optional.

**State machine phases:**
`idle → configuring → generating → proposals_ready → expanding → reviewing → done/error`

**Pipeline routing in `runAgentGenerate`:**
- `expand_description` / `create_child` / `reorganize` → propose (3 cards) → expand (draft) → review
- `propose_children` → proposeChildren (10 stubs) → checkbox select → batch create
- `expand_chronology` → chronology agent (no proposals) → review
- `summarize` → summarize agent → review → apply via `PATCH /bible/:aid`
- `cohere` → cohere agent → review (warnings only, nothing to commit)

**Manual vs AI paths per document layer:**
| Layer | Manual | AI |
|---|---|---|
| Introduction | Textarea → `PATCH /bible/:aid` | AgentPanel Summarize → Accept |
| Description | TipTap (`InlineDescriptionEditor`) → `PATCH /articles/:aid` | AgentPanel Expand → Propose → Expand → Accept |
| Subjects | "Add Subsection" dialog → `POST /articles/batch` | AgentPanel Propose Children → batch Accept |
| Chronology | TipTap (`ChronologyEditor`) + `mergeChronology` | AgentPanel Expand Chronology → Accept |

**Future chaining**: add `queue: AgentTask[]` + `runNext()` to `agentSlice` — no restructuring needed.

---

## Key API Endpoints

```
GET    /health

POST   /api/worlds                          create world + 8 default categories
GET    /api/worlds                          list worlds
GET    /api/worlds/:wid                     get world
PATCH  /api/worlds/:wid                     update world
DELETE /api/worlds/:wid                     delete world

GET    /api/worlds/:wid/categories          list categories
POST   /api/worlds/:wid/categories          create category
PATCH  /api/worlds/:wid/categories/:cid    update category
DELETE /api/worlds/:wid/categories/:cid    delete category

GET    /api/worlds/:wid/articles            list (filter: category, status, q)
POST   /api/worlds/:wid/articles            create article manually
GET    /api/worlds/:wid/articles/tree       flat list for tree building (depth, parentId)
GET    /api/worlds/:wid/articles/:aid       article + current version + links + warnings
PATCH  /api/worlds/:wid/articles/:aid       manual edit → new version
DELETE /api/worlds/:wid/articles/:aid       delete
POST   /api/worlds/:wid/articles/batch      bulk create child stubs with hierarchical links

GET    /api/worlds/:wid/articles/:aid/versions        list version history
GET    /api/worlds/:wid/articles/:aid/versions/:vid   preview version
POST   /api/worlds/:wid/articles/:aid/revert/:vid     revert (non-destructive, creates new version)

GET    /api/worlds/:wid/articles/:aid/draft    get pending draft (crash recovery)
POST   /api/worlds/:wid/articles/:aid/draft    save/update draft
DELETE /api/worlds/:wid/articles/:aid/draft    discard
POST   /api/worlds/:wid/articles/:aid/accept   commit pending draft → new version

GET    /api/worlds/:wid/bible               all Bible entries + token count
GET    /api/worlds/:wid/bible/render        full rendered markdown (LLM context)
PATCH  /api/worlds/:wid/bible/:aid          edit one article's Introduction/summary

GET    /api/settings                        provider settings (keys masked)
PATCH  /api/settings                        set provider + API key
POST   /api/settings/test                   test active provider connection
GET    /api/settings/ollama/models          list local Ollama models

GET    /api/worlds/:wid/settings            per-world cost settings
PATCH  /api/worlds/:wid/settings            update daily cap / Bible threshold

GET    /api/worlds/:wid/call-log            paginated call log

POST   /api/worlds/:wid/agents/estimate     token estimate (no LLM call)
POST   /api/worlds/:wid/agents/skeleton     generate initial article stubs
POST   /api/worlds/:wid/agents/propose      3 creative direction proposals
POST   /api/worlds/:wid/agents/expand       Phase 2 expand from selected proposal
POST   /api/worlds/:wid/agents/propose-children  10 child article proposals
POST   /api/worlds/:wid/agents/summarize    standalone Introduction refresh
POST   /api/worlds/:wid/agents/reorganize   reorganize Description (RetentionAgent safety check)
POST   /api/worlds/:wid/agents/cohere       standalone coherence check
POST   /api/worlds/:wid/agents/chronology   generate Chronology section
POST   /api/worlds/:wid/agents/compress     Bible compression preview

GET    /api/worlds/:wid/snapshots           list snapshots
POST   /api/worlds/:wid/snapshots           create named snapshot
GET    /api/worlds/:wid/snapshots/:sid      preview snapshot (article list)
POST   /api/worlds/:wid/snapshots/:sid/restore  restore snapshot (auto-saves current first)
DELETE /api/worlds/:wid/snapshots/:sid      delete snapshot

GET    /api/worlds/:wid/export              download ZIP of all articles as .md files
```

---

## Allowed Tool Permissions

Pre-approved in `.claude/settings.local.json`:
- `npx tsc:*` — TypeScript type-checking
- `python3 -c` / `python3 *.py` — running Python scripts
- `ollama list *` — querying local Ollama models
- `mcp__context7__query-docs` — fetching library documentation via Context7
