# WorldArchitect — Build Blocks

**Last updated:** 2026-04-28  
**Arch ref:** [docs/draft_arch.md](./draft_arch.md)

Each block is independently testable before the next begins.  
Blocks 1–9 are server-only — testable with curl or a REST client (no frontend needed).  
Blocks 10–16 are client-only — they require Blocks 1–9 to be complete.

## Completion Status

| Block | Description | Status |
|---|---|---|
| 1 | Monorepo + DB + health check | ✅ Done |
| 2 | World & Category CRUD | ✅ Done |
| 3 | Article CRUD + versioning + drafts | ✅ Done |
| 4 | World Bible service | ✅ Done |
| 5 | Provider abstraction + call logger + settings | ✅ Done |
| 6 | BaseAgent (tool-use loop) + SkeletonAgent + document model | ✅ Done |
| 7 | ProposalAgent + ExpanderAgent + SummarizerAgent + ChildProposerAgent + CoherenceAgent + RetentionAgent | ✅ Done |
| 8 | ChroniclerAgent + BibleCompressorAgent | ✅ Done |
| 9 | Snapshots + ZIP export | 🔲 Next |
| 10 | React scaffolding + routing | 🔲 |
| 11 | World creation + encyclopedia browser | 🔲 |
| 12 | TipTap editor + version history UI | 🔲 |
| 13 | Expansion panel (MAS UI) | 🔲 |
| 14 | Chronology + Timeline UI | 🔲 |
| 15 | World Bible editor + Usage panel | 🔲 |
| 16 | Snapshots UI + Export + Polish | 🔲 |

---

## Server Blocks

---

### Block 1 — Foundation: Monorepo + DB + Health Check

**What it builds:**
- Root `package.json` with npm workspaces (`client/`, `server/`) and `concurrently`
- `server/package.json`, `server/tsconfig.json`
- `server/src/index.ts` — Express app, single `GET /health` endpoint
- `server/src/db/index.ts` — SQLite connection singleton, WAL mode enabled, `data/` directory auto-created
- `server/src/db/schema.ts` — all `CREATE TABLE IF NOT EXISTS` statements (all 12 tables)

**Depends on:** nothing

**How to test:**
```bash
npm run dev
# Expected: server starts on :3001, client Vite starts on :5173 (placeholder)
curl http://localhost:3001/health
# Expected: { "status": "ok", "db": "data/worldarchitect.db" }
# Expected: data/worldarchitect.db exists on disk
# Expected: .tables in sqlite3 CLI shows all tables
```

---

### Block 2 — World & Category CRUD

**What it builds:**
- `server/src/routes/worlds.ts` — POST, GET list, GET one, PATCH, DELETE
- `server/src/routes/categories.ts` — GET, POST, PATCH (rename/reorder/hide), DELETE
- Wired into Express app

**Depends on:** Block 1

**How to test:**
```bash
# Create a world
curl -X POST http://localhost:3001/api/worlds \
  -H "Content-Type: application/json" \
  -d '{"name":"Aethon","description":"A world of ancient empires and forgotten gods","tone":"narrative"}'
# Expected: { id, name, description, tone, createdAt, updatedAt }

# List worlds
curl http://localhost:3001/api/worlds
# Expected: array with 1 world

# List categories (8 defaults created on world creation)
curl http://localhost:3001/api/worlds/:wid/categories
# Expected: 8 categories (Religion, Technology, Politics, Economy, Culture, Geography, History, Notable Figures)

# Rename a category
curl -X PATCH http://localhost:3001/api/worlds/:wid/categories/:cid \
  -d '{"name":"Mythology"}'
# Expected: updated category
```

---

### Block 3 — Article CRUD + Versioning

**What it builds:**
- `server/src/routes/articles.ts`
  - CRUD: POST, GET list, GET one, PATCH (manual edit → new version), DELETE
  - Versions: GET list, GET one preview, POST revert
  - Draft: GET, POST save, DELETE discard
  - `POST /accept` — commit draft to new version
  - `POST /batch` — bulk create child stubs in one transaction

**Depends on:** Block 2

**How to test:**
```bash
# Create article manually
curl -X POST http://localhost:3001/api/worlds/:wid/articles \
  -H "Content-Type: application/json" \
  -d '{"categoryId":":cid","title":"The Iron Throne","templateType":"faction","body":"## Description\n\nA ruling council...","summary":"Ruling council of the capital."}'
# Expected: article with version_number=1

# Edit article (manual — creates version 2)
curl -X PATCH http://localhost:3001/api/worlds/:wid/articles/:aid \
  -H "Content-Type: application/json" \
  -d '{"body":"## Description\n\nA ruling council of seven lords...\n\n## Chronology","summary":"Council of seven lords."}'
# Expected: article with current_version pointing to v2

# List version history
curl http://localhost:3001/api/worlds/:wid/articles/:aid/versions
# Expected: [{version_number:1,...},{version_number:2,...}]

# Revert to version 1 (creates version 3, is_revert=1)
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/revert/:v1id
# Expected: new version with version_number=3, is_revert=true
```

---

### Block 4 — World Bible Service

**What it builds:**
- `server/src/services/worldBible.ts`
  - `upsertEntry(worldId, articleId, summary)` — insert or update one entry
  - `renderBible(worldId)` — full markdown string grouped by category
  - `getEntries(worldId)` — all entries with article + category metadata
  - `getBibleMeta(worldId)` — materialised token count + threshold
- `server/src/routes/bible.ts`
  - `GET /worlds/:wid/bible` — all entries + token count
  - `PATCH /worlds/:wid/bible/:aid` — edit one article's summary
  - `GET /worlds/:wid/bible/render` — full rendered markdown

**Depends on:** Block 3

**How to test:**
```bash
# Render bible
curl http://localhost:3001/api/worlds/:wid/bible/render
# Expected: markdown grouped by category:
# ## Religion
# ### Article Title
# summary text...

# Edit one summary
curl -X PATCH http://localhost:3001/api/worlds/:wid/bible/:aid \
  -H "Content-Type: application/json" \
  -d '{"summary":"Updated summary."}'
# Expected: updated entry; render reflects the change
```

---

### Block 5 — Provider Abstraction + Call Logger + Settings

**What was built:**
- `server/src/providers/types.ts` — `LLMProvider` interface, `ChatMessage`, `CompletionOptions`, `CompletionResult`, `Tool`, `ToolCall`
- `server/src/providers/anthropic.ts` — `AnthropicProvider` (real `count_tokens` API)
- `server/src/providers/openai.ts` — `OpenAICompatibleProvider` (OpenAI, Groq, Ollama via baseURL swap)
- `server/src/providers/index.ts` — `getProvider()`, `requireLLM` middleware, `maskKey()`, `readProviderSettings()`
- `server/src/services/callLogger.ts` — `logCall()`, `checkDailyCap()`, `getDailyCallCount()`
- `server/src/routes/settings.ts` — global `GET/PATCH /api/settings`, `POST /api/settings/test`, `GET /api/settings/ollama/models`; exports `worldSettingsRouter` for per-world cost settings
- `server/src/routes/callLog.ts` — paginated `GET /api/worlds/:wid/call-log`

**Key behaviours:**
- `provider = 'none'` (default) → all manual features work; agent routes return `503`
- Switching providers preserves other providers' stored keys
- Keys stored in `provider_settings.config` JSON, masked on all GET responses

---

### Block 6 — BaseAgent + SkeletonAgent + Document Model ✅ Done

**What was built:**

**Document model (three-layer):**
- **Introduction** (1 paragraph) — stored in `world_bible_entries.summary`; never in the article body
- **Description** (3–5 paragraphs) — `## Description` section of the article body
- **Chronology** (events) — `## Chronology` section of the article body
- **Subjects** — dynamically assembled from hierarchical child articles at render time

**Body format (universal):**
```
## Description

[3–5 paragraphs]

## Chronology

[events — empty for stubs]
```

**New files:**
- `server/src/services/sections.ts` — `splitSections(body)` → `{ description, chronology }`; `mergeSections(description, chronology)` → body with both headings always present
- `server/src/services/archivist.ts` — `buildContextPackage(worldId, articleId, options?)` — tiered context assembly; modes: `default | expand_chronology | propose_children | reorganize`
- `server/src/tools/context.ts` — read-only DB tools: `get_world_bible`, `get_article`, `search_articles`, `get_timeline`
- `server/src/tools/output.ts` — output tool definitions: `submit_stubs`, `submit_proposals`, `submit_description`, `submit_child_description`, `submit_introduction`, `submit_child_proposals`, `submit_chronology`, `submit_coherence_check`, `submit_retention_check`, `submit_compression`
- `server/src/agents/base.ts` — `BaseAgent` abstract class: tool-use loop (max 6 iterations), Zod validation, call logging
- `server/src/agents/skeleton.ts` + `server/src/prompts/skeleton.ts`
- `server/src/routes/agents.ts` — `POST /agents/estimate` + `POST /agents/skeleton`

**Schema additions:**
- `articles.depth INTEGER` — graph depth (world root = 1; skeleton stubs = 2; `create_child` = parent.depth + 1)

**Depends on:** Block 5

**How to test:**
```bash
# Configure a provider
curl -X PATCH http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -d '{"provider":"groq","apiKey":"gsk_..."}'

curl -X POST http://localhost:3001/api/settings/test
# Expected: { ok: true, provider: "groq" }

# Estimate tokens before any call (no LLM call made)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/estimate \
  -H "Content-Type: application/json" \
  -d '{"extraText":"Some additional context here"}'
# Expected: { estimatedTokens: N }

# Run SkeletonAgent
curl -X POST http://localhost:3001/api/worlds/:wid/agents/skeleton \
  -H "Content-Type: application/json" \
  -d '{"seedText":"Heaven is organized like a bureaucracy. The sun god files forms in triplicate."}'
# Expected: { stubs: [{ categoryName, title, summary, templateType }], worldBibleTokenCount: N }
# Expected: articles created in DB with depth=2, body="## Description\n\n## Chronology"
# Expected: world_bible_entries populated; call_log has 1 entry

# Verify stub body format
curl http://localhost:3001/api/worlds/:wid/articles/:aid
# Expected: body = "## Description\n\n## Chronology" (stub has empty sections)

# requireLLM blocks when provider = none
curl -X PATCH http://localhost:3001/api/settings -H "Content-Type: application/json" -d '{"provider":"none"}'
curl -X POST http://localhost:3001/api/worlds/:wid/agents/skeleton -d '{"seedText":"..."}'
# Expected: 503 { error: "No LLM provider configured." }
```

---

### Block 7 — Full Article Expansion Pipeline ✅ Done

**What was built:**

**Three-parameter agent architecture:** every agent receives `{ contextPackage, worldContext, userSpec? }`.

**Agents:**
- `ProposalAgent` — generates 3 creative direction proposals (`{ title, direction }`) for expand/create flows
- `ExpanderAgent` — writes `## Description` in 4 modes: `expand_description | create_root | create_child | reorganize`; child mode additionally outputs `parentAppend`
- `SummarizerAgent` — derives 1-paragraph Introduction from Description; auto-runs after every Expander call
- `ChildProposerAgent` — proposes 10 child article stubs (`{ title, introduction, templateType }`) from an article's Description
- `CoherenceAgent` — safety layer; checks new content against world context for contradictions
- `RetentionAgent` — safety layer for reorganize; verifies all facts from original body are preserved

**New routes (`POST /api/worlds/:wid/agents/...`):**
| Route | Pipeline |
|---|---|
| `/propose` | Archivist → ProposalAgent → 3 proposals |
| `/expand` | Expander (seeded with proposal) → Summarizer → CoherenceAgent |
| `/propose-children` | Archivist [propose_children] → ChildProposerAgent → 10 proposals |
| `/summarize` | Summarizer only (standalone preview) |
| `/reorganize` | Archivist [reorganize] → Expander → RetentionAgent → Summarizer |
| `/cohere` | CoherenceAgent only (standalone) |

**New route:** `POST /api/worlds/:wid/articles/batch` — DB-only bulk child stub creation; no agent call.

**Updated:** `POST /api/worlds/:wid/articles/:aid/accept` — dispatches per `pipelineType`:
- `expand_description / create_root / reorganize` → merge new Description into body; upsert Bible entry
- `expand_chronology` → merge new Chronology into body
- `create_child` → 2-write transaction: new child article + version + hierarchical link + parent new version

**Depends on:** Block 6

**How to test:**
```bash
# Phase 1: 3 proposals for expanding an existing article
curl -X POST http://localhost:3001/api/worlds/:wid/agents/propose \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","pipelineType":"expand_description","userSpec":"Focus on internal politics"}'
# Expected: { proposals: [{ title, direction }, { title, direction }, { title, direction }] }
# Expected: call_log has 1 entry (proposal, success)

# Phase 2: expand using selected proposal
curl -X POST http://localhost:3001/api/worlds/:wid/agents/expand \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","pipelineType":"expand_description","selectedProposalIndex":0,"proposals":[...]}'
# Expected: { description, introduction, coherenceWarnings[], suggestedLinks[] }
# Expected: description is 3–5 paragraphs; introduction is 1 paragraph
# Expected: call_log has 2 new entries (expander + coherence)

# Create a child article
curl -X POST http://localhost:3001/api/worlds/:wid/agents/propose \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","pipelineType":"create_child"}'
# then expand with pipelineType="create_child"
# Expected: { description, introduction, coherenceWarnings[], parentUpdate: { appendText } }

# Propose 10 child stubs
curl -X POST http://localhost:3001/api/worlds/:wid/agents/propose-children \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid"}'
# Expected: { proposals: [10 × { title, introduction, templateType }] }

# Batch-create 3 selected child stubs (DB-only, no agent)
curl -X POST http://localhost:3001/api/worlds/:wid/articles/batch \
  -H "Content-Type: application/json" \
  -d '{"parentArticleId":":aid","children":[{"title":"...","introduction":"...","templateType":"general"},...]}'
# Expected: { created: [{ id, title }, ...] }
# Expected: 3 new stub articles in DB with depth=parent.depth+1, hierarchical links, Bible entries

# Standalone intro refresh (preview)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/summarize \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid"}'
# Expected: { introduction } — 1 paragraph; apply via PATCH /bible/:aid

# Reorganize (reorder Description without adding/removing facts)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/reorganize \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid"}'
# Expected: { description, introduction, retentionIssues[] }
# Expected: retentionIssues is empty when all facts are preserved

# Standalone coherence check
curl -X POST http://localhost:3001/api/worlds/:wid/agents/cohere \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid"}'
# Expected: { warnings[], suggestedLinks[] }
```

---

### Block 8 — Chronicler + BibleCompressor ✅ Done

**What was built:**

**Agents:**
- `ChroniclerAgent` — writes the `## Chronology` section using the article's Description, Subjects (child articles' Introductions), temporal neighbours, and parent context; runs in Archivist `expand_chronology` mode
- `BibleCompressorAgent` — bulk-compresses all World Bible entries to be more concise while preserving every key fact; preview only (no DB writes)

**New routes (`POST /api/worlds/:wid/agents/...`):**
| Route | Pipeline |
|---|---|
| `/chronology` | Archivist [expand_chronology: temporal + children first] → Chronicler → CoherenceAgent |
| `/compress` | BibleCompressor (preview — apply each entry via `PATCH /bible/:aid`) |

**Archivist `expand_chronology` mode tier ordering:**
1. Temporal neighbours (articles nearest in time)
2. Children (Subjects — their Introductions are raw material for the Chronology)
3. Parents → siblings → fixed points → referenced

**Depends on:** Block 7

**How to test:**
```bash
# Expand chronology (requires article with non-empty Description and/or children)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/chronology \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","userSpec":"Focus on the founding era"}'
# Expected: { chronologySection, coherenceWarnings[], suggestedLinks[] }
# Expected: chronologySection lists events in chronological order (no heading)
# Expected: call_log has 2 entries (chronicler + coherence)

# Accept chronology → merges into body, Description unchanged
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/accept \
  -H "Content-Type: application/json" \
  -d '{"pipelineType":"expand_chronology","draftContent":{"chronologySection":"..."},"introduction":"..."}'
# Verify: splitSections(body).chronology matches Chronicler output; description unchanged

# Bulk Bible compression (preview only)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/compress
# Expected: { entries: [{ articleId, compressedSummary, tokensBefore, tokensAfter }] }
# Expected: no DB changes — apply selected entries via PATCH /bible/:aid

# Full type-check (should be clean after all blocks)
npx tsc --noEmit -p server/tsconfig.json
```

---

### Block 9 — Snapshots + Export

**What it builds:**
- `server/src/routes/snapshots.ts` — list, create, preview, restore, delete
- `server/src/services/exporter.ts` — builds JSZip from all articles, one `.md` per article
- `server/src/routes/export.ts` — streams ZIP to client

**Depends on:** Block 3 (no agent dependency)

**How to test:**
```bash
# Create a named snapshot
curl -X POST http://localhost:3001/api/worlds/:wid/snapshots \
  -H "Content-Type: application/json" \
  -d '{"name":"Pre-war draft"}'
# Expected: { id, name, createdAt }

# List snapshots
curl http://localhost:3001/api/worlds/:wid/snapshots
# Expected: [{ id, name, createdAt }]

# Expand an article, then restore snapshot (rolls back to pre-expansion state)
curl -X POST http://localhost:3001/api/worlds/:wid/snapshots/:sid/restore
# Expected: articles match the snapshot state; current state auto-saved as new snapshot

# Export ZIP
curl -o aethon.zip http://localhost:3001/api/worlds/:wid/export
unzip -l aethon.zip
# Expected: one .md file per article, named by title
```

---

## Client Blocks

*Requires all server blocks complete and running.*

---

### Block 10 — React Scaffolding + Routing

**What it builds:**
- `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`
- Tailwind CSS + `@tailwindcss/typography` configured
- `react-router-dom` v6 with all routes defined in `client/src/routes.tsx`
- `client/src/App.tsx` — `<RouterProvider>`
- Placeholder page components for every route (just a `<h1>` each)
- `client/src/lib/api.ts` — typed fetch wrappers for all server endpoints
- `client/src/types/` — all shared TypeScript interfaces

**Depends on:** Block 1 (server running)

**How to test:**
- App loads at `http://localhost:5173`
- Navigate to `/worlds/fake-id` — renders "World Overview" placeholder
- Navigate to `/worlds/fake-id/articles/fake-aid` — renders "Article" placeholder
- Browser back/forward works between routes
- No TypeScript errors: `npx tsc --noEmit`

---

### Block 11 — World Creation + Encyclopedia Browser

**What it builds:**
- `client/src/stores/worldSlice.ts` + `articleSlice.ts` + `uiSlice.ts` (bound store)
- `WorldList.tsx` — fetches worlds, links to each
- `WorldCreationWizard.tsx` — form → POST `/api/worlds` → redirects to world view
- `AppShell.tsx` — sidebar + topbar wrapper for all `/worlds/:wid/*` routes
- `Sidebar.tsx` — category tree, article list, search
- `ArticlePage.tsx` — read-only article view (renders Introduction + Description + Subjects + Chronology via `@tailwindcss/typography`)
- `StatusBadge.tsx`, `WorldBibleMeter.tsx` (token count in topbar)

**Depends on:** Block 10 + Block 6 (skeleton agent)

**How to test:**
- Open app → WorldList shows existing worlds
- Click "New World" → wizard → submit → redirects to `/worlds/:wid`
- Sidebar shows 8 categories with stub articles
- Click an article → `/worlds/:wid/articles/:aid` → renders Introduction, Description, Subjects (children), Chronology sections
- Search bar filters articles in sidebar
- World Bible token meter shows count from server

---

### Block 12 — TipTap Editor + Version History UI

**What it builds:**
- `ArticleEditor.tsx` — TipTap with markdown extension, read/write toggle (edits Description only)
- `VersionHistoryPanel.tsx` — version list, preview, revert button
- `PATCH /api/worlds/:wid/articles/:aid` wired to editor save

**Depends on:** Block 11

**How to test:**
- Open an article → click "Edit" → TipTap editor appears with Description content
- Edit and save → version 2 created, topbar shows updated timestamp
- Open version history → two versions listed with timestamps + word counts
- Click "Preview" on v1 → shows old content
- Click "Revert to v1" → confirm dialog → v3 created with v1 content

---

### Block 13 — Expansion Panel (Full MAS UI)

**What it builds:**
- `client/src/stores/expansionSlice.ts` — phase machine: idle → proposing → proposal_ready → expanding → draft_ready → accepted/rejected
- `client/src/hooks/useExpansion.ts` — orchestrates Phase 1 (propose) + Phase 2 (expand) API calls
- `ExpansionPanel.tsx` — slide-over drawer, renders correct view per phase
- `ProposalCard.tsx` — 3-up proposal cards with select + optional user spec
- `DraftReview.tsx` — shows Description + Introduction from expand response; accept/reject buttons
- `ChildProposalFlow.tsx` — propose 10 child stubs, select N, batch create
- `DraftCrashRecovery.tsx` — "Resume draft?" banner on article open when pending draft exists

**Depends on:** Block 12 + Block 7

**How to test:**
- Open any article → click "Expand" → drawer opens
- Click "Generate Proposals" → loading → 3 ProposalCard components appear
- Select a proposal + add optional user spec → click "Expand" → loading → draft review appears
- Review Description (3–5 paras) + Introduction (1 para) → click "Accept" → article committed; body updated; Bible entry updated
- Click "Reject" → back to proposals
- Try "Propose Children" → 10 proposals shown → select N → click "Create" → N stub articles appear in sidebar
- Try "Reorganize" → draft appears with retention issues panel (empty if clean)
- Close browser mid-expand → reopen article → crash recovery banner appears

---

### Block 14 — Chronology + Timeline UI

**What it builds:**
- `ChronologySection.tsx` — renders `## Chronology` within the article page
- `ChronologyEditor.tsx` — drawer for expanding the Chronology via `POST /agents/chronology`
- `TimelineView.tsx` — horizontal scrollable axis, event markers from articles with `temporal_anchor`
- `TimelineEvent.tsx` — event marker with popover (title, summary, link to article)

**Depends on:** Block 13 + Block 8 (Chronicler)

**How to test:**
- Navigate to `/worlds/:wid/timeline`
- Articles with temporal anchors appear as markers on the axis
- Click a marker → popover with summary + "Go to article" link
- Open an article → click "Expand Chronology" → Chronicler runs → draft Chronology appears
- Review chronology events + any coherence warnings → accept → `## Chronology` section in article body updated
- Description remains unchanged after chronology accept

---

### Block 15 — World Bible Editor + Usage Panel

**What it builds:**
- `WorldBibleEditor.tsx` — per-article summary list with inline editable text areas
- BibleCompressor UI: "Compress Bible" button → preview diff table (before/after tokens) → apply selected
- `client/src/hooks/useCallLog.ts`
- Usage panel page (`/worlds/:wid/usage`): call log table, daily counter, cost settings form
- `CoherenceWarningBanner.tsx` — shown on article page when open warnings exist

**Depends on:** Block 13 + Block 8 (BibleCompressor + CoherenceAgent)

**How to test:**
- Navigate to `/worlds/:wid/bible` → all article Introductions listed, editable
- Edit a summary → token meter in topbar updates
- Click "Compress Bible" → preview shows before/after token counts per entry → apply selected → summaries condensed
- Open an article with coherence warnings → banner shows warning descriptions + "Ignore" button
- Navigate to `/worlds/:wid/usage` → call log table shows all past calls (agent type, tokens, status)
- Set daily cap to 3 → make 3 calls → 4th call blocked with warning

---

### Block 16 — Snapshots UI + Export + Final Polish

**What it builds:**
- Snapshots page (`/worlds/:wid/snapshots`) — list, create named snapshot, preview, restore
- Export button in topbar → downloads ZIP via `GET /worlds/:wid/export`
- `Toast.tsx` + `ConfirmDialog.tsx` — wired to all destructive/irreversible actions
- Confirm dialogs: delete world, revert, restore snapshot, discard draft

**Depends on:** Block 15 + Block 9 (snapshots + export)

**How to test:**
- Navigate to `/worlds/:wid/snapshots` → create "v1 complete" snapshot
- Expand several articles → restore snapshot → confirm dialog → articles roll back
- Current state auto-saved as "Auto-save before restore [timestamp]"
- Click Export in topbar → ZIP downloads → unzip → one `.md` per article
- Delete a world → confirm dialog → redirects to WorldList
- All toast notifications appear for: agent errors, successful commits, cap warnings

---

## Summary Table

| Block | Layer | Key deliverable | Test method |
|---|---|---|---|
| 1 | Server | DB schema + health check | `curl /health`, inspect DB file |
| 2 | Server | World & Category CRUD | curl CRUD operations |
| 3 | Server | Article CRUD + versioning | curl edit/revert/batch flow |
| 4 | Server | World Bible service | curl render, verify markdown output |
| 5 | Server | Provider abstraction + call log | curl settings, test connection |
| 6 | Server | BaseAgent + SkeletonAgent + document model | curl /skeleton, inspect body format |
| 7 | Server | Full expansion pipeline (propose → expand → accept) | curl Phase 1 → 2 → accept + batch |
| 8 | Server | Chronicler + BibleCompressor | curl /chronology, /compress |
| 9 | Server | Snapshots + ZIP export | curl snapshot flow, download ZIP |
| 10 | Client | Routing + scaffolding | browser navigation, `tsc --noEmit` |
| 11 | Client | World creation + article browser | full creation flow in browser |
| 12 | Client | TipTap editor + version history | edit, revert in browser |
| 13 | Client | Expansion panel (MAS UI) | full Phase 1 → 2 flow in browser |
| 14 | Client | Chronology editor + Timeline view | expand chronology, timeline renders |
| 15 | Client | World Bible editor + Usage panel | compress summaries, view call log |
| 16 | Client | Snapshots UI + Export + polish | snapshot/restore, ZIP download |
