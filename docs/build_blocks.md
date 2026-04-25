# WorldArchitect — Build Blocks

**Last updated:** 2026-04-25  
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
| 6 | BaseAgent (tool-use loop) + SkeletonAgent | 🔲 Next |
| 7 | ProposalAgent + ExpansionAgent | 🔲 |
| 8 | CoherenceAgent + HistoryAgent + CompressionAgent | 🔲 |
| 9 | Snapshots + ZIP export | 🔲 |
| 10 | React scaffolding + routing | 🔲 |
| 11 | World creation + encyclopedia browser | 🔲 |
| 12 | TipTap editor + version history UI | 🔲 |
| 13 | Expansion panel (MAS UI) | 🔲 |
| 14 | Timeline + History agent UI | 🔲 |
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
- `server/src/db/schema.ts` — all `CREATE TABLE IF NOT EXISTS` statements (all 11 tables)

**Depends on:** nothing

**How to test:**
```bash
npm run dev
# Expected: server starts on :3001, client Vite starts on :5173 (placeholder)
curl http://localhost:3001/health
# Expected: { "status": "ok", "db": "data/worldarchitect.db" }
# Expected: data/worldarchitect.db exists on disk
# Expected: .tables in sqlite3 CLI shows all 11 tables
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
- `server/src/routes/drafts.ts`
  - GET pending draft, DELETE (discard), POST accept

**Depends on:** Block 2

**How to test:**
```bash
# Create article manually
curl -X POST http://localhost:3001/api/worlds/:wid/articles \
  -d '{"categoryId":":cid","title":"The Iron Throne","templateType":"faction","body":"A ruling council...","summary":"Ruling council of the capital."}'
# Expected: article with version_number=1

# Edit article (manual — creates version 2)
curl -X PATCH http://localhost:3001/api/worlds/:wid/articles/:aid \
  -d '{"body":"A ruling council of seven lords...","summary":"Council of seven lords."}'
# Expected: article with current_version pointing to v2

# List version history
curl http://localhost:3001/api/worlds/:wid/articles/:aid/versions
# Expected: [{version_number:1,...},{version_number:2,...}]

# Revert to version 1 (creates version 3, is_revert=1)
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/revert/:v1id
# Expected: new version with version_number=3, is_revert=true

# Save a pending draft
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/draft \
  -d '{"selectedProposal":{"title":"X","summary":"Y"},"expansionParams":{...},"phase":"proposal_selected"}'
# Expected: pending draft row

# Accept draft (commits article, bumps version)
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/accept \
  -d '{"body":"Full article body...","summary":"Short summary."}'
# Expected: committed article version
```

---

### Block 4 — World Bible Service

**What it builds:**
- `server/src/services/worldBible.ts`
  - `buildBible(worldId)` — aggregates `world_bible_entries` rows, renders to markdown sorted by category
  - `upsertEntry(worldId, articleId, summary)` — insert or update one entry
  - `renderBible(worldId)` — returns full markdown string
- `server/src/routes/bible.ts`
  - `GET /worlds/:wid/bible` — all entries + token count
  - `PATCH /worlds/:wid/bible/:aid` — edit one article's summary
  - `GET /worlds/:wid/bible/render` — full rendered markdown

**Depends on:** Block 3

**How to test:**
```bash
# Create 2-3 articles with summaries (from Block 3)
# then:
curl http://localhost:3001/api/worlds/:wid/bible/render
# Expected: markdown grouped by category:
# ## Religion
# ### Article Title
# summary text...

# Edit one summary
curl -X PATCH http://localhost:3001/api/worlds/:wid/bible/:aid \
  -d '{"summary":"Updated summary."}'
# Expected: updated entry

# Verify render reflects the change
curl http://localhost:3001/api/worlds/:wid/bible/render
# Expected: updated summary in output
```

---

### Block 5 — Provider Abstraction + Call Logger + Settings  ✅ DONE

**What was built:**
- `server/src/db/schema.ts` — added `provider_settings` singleton table (seeded on startup)
- `server/src/providers/types.ts` — `LLMProvider` interface, `ChatMessage`, `CompletionOptions`, `CompletionResult`, `Tool`, `ToolCall`
- `server/src/providers/anthropic.ts` — `AnthropicProvider` (real `count_tokens` API)
- `server/src/providers/openai.ts` — `OpenAICompatibleProvider` (OpenAI, Groq, Ollama via baseURL swap)
- `server/src/providers/index.ts` — `getProvider()`, `requireLLM` middleware, `maskKey()`, `readProviderSettings()`, `writeProviderSettings()`
- `server/src/services/callLogger.ts` — `logCall()`, `checkDailyCap()`, `getDailyCallCount()`
- `server/src/services/tokenEstimator.ts` — `estimateCallTokens()`, `updateBibleTokenCount()` (real API or char fallback)
- `server/src/routes/settings.ts` — global `GET/PATCH /api/settings`, `POST /api/settings/test`, `GET /api/settings/ollama/models`; exports `worldSettingsRouter` for per-world cost settings
- `server/src/routes/callLog.ts` — paginated `GET /api/worlds/:wid/call-log`

**Key behaviours:**
- `provider = 'none'` (default) → all manual features work; agent routes return `503`
- Switching providers preserves other providers' stored keys
- Keys stored in `provider_settings.config` JSON, masked on all GET responses
- `POST /api/settings/test` makes a real minimal completion call to verify the key

---

### Block 6 — BaseAgent (Tool-Use Loop) + SkeletonAgent

**What it builds:**
- `server/src/tools/context.ts` — read-only DB tools: `get_world_bible`, `get_article`, `search_articles`, `get_timeline`
- `server/src/tools/output.ts` — output tool definitions (one per agent): `submit_stubs`, `submit_proposals`, `submit_expansion`, `submit_coherence_check`, `submit_compression`
- `server/src/agents/base.ts` — `BaseAgent` abstract class: tool-use loop (max 6 iterations), Zod validation on tool inputs, call logging, `requireLLM` guard, Ollama JSON-prompt fallback
- `server/src/agents/skeleton.ts` + `server/src/prompts/skeleton.ts`
- `server/src/routes/agents.ts` — `POST /agents/estimate` + `POST /agents/skeleton`
- Update `POST /api/worlds` — if LLM configured, runs SkeletonAgent after creating stubs; if not, returns empty stubs silently (no error)

**Depends on:** Block 5

**How to test:**
```bash
# First configure a provider:
curl -X PATCH http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

# Test connection
curl -X POST http://localhost:3001/api/settings/test
# Expected: { ok: true, provider: "anthropic", response: "ok" }

# Create world WITH agent (LLM configured)
curl -X POST http://localhost:3001/api/worlds \
  -H "Content-Type: application/json" \
  -d '{"name":"Aethon","description":"A world where gods run heaven like a corporation","tone":"academic","seedText":"Heaven is organized like a bureaucracy. The sun god files forms."}'
# Expected:
# - world + 8 categories created
# - ~8-16 stub articles with summaries (from SkeletonAgent)
# - world_bible_entries populated
# - call_log has 1 entry (skeleton, success, tokensIn/Out set)

curl http://localhost:3001/api/worlds/:wid/bible/render
# Expected: populated World Bible grouped by category

# Estimate tokens before a call (no LLM call made)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/estimate \
  -H "Content-Type: application/json" \
  -d '{"extraText":"Article: The Iron Throne\nExpansion: medium detail focused"}'
# Expected: { estimatedTokens: N }

# Create world WITHOUT agent (provider = none or reset)
curl -X PATCH http://localhost:3001/api/settings -d '{"provider":"none"}'
curl -X POST http://localhost:3001/api/worlds \
  -H "Content-Type: application/json" \
  -d '{"name":"Manual World","description":"A world built entirely by hand without any AI","tone":"narrative"}'
# Expected: world + 8 categories + 8 empty stubs — NO call_log entry, NO error

# requireLLM blocks agent routes when provider = none
curl -X POST http://localhost:3001/api/worlds/:wid/agents/skeleton \
  -d '{"seedText":"..."}'
# Expected: 503 { error: "No LLM provider configured.", hint: "..." }
```

---

### Block 7 — ProposalAgent + ExpansionAgent (Full Phase 1 → 2 flow)

**What it builds:**
- `server/src/agents/proposal.ts` + `server/src/prompts/proposal.ts`
- `server/src/agents/expansion.ts` + `server/src/prompts/expansion.ts`
- `POST /api/worlds/:wid/agents/propose` — Phase 1
- `POST /api/worlds/:wid/agents/expand` — Phase 2 (saves to `pending_drafts`)
- Update `POST /api/worlds/:wid/articles/:aid/accept` — also calls `upsertEntry()` to update World Bible

**Depends on:** Block 6

**How to test:**
```bash
# Phase 1: 3 proposals
curl -X POST http://localhost:3001/api/worlds/:wid/agents/propose \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","expansionParams":{"wordCountPreset":"medium","detailDepth":"detailed","chronologicalDepth":"shallow","breadth":"focused"}}'
# Expected: { proposals: [{title,summary}×3] }  — call_log: 1 entry (proposal, success)

# Phase 2: expand
curl -X POST http://localhost:3001/api/worlds/:wid/agents/expand \
  -H "Content-Type: application/json" \
  -d '{"articleId":":aid","selectedProposal":{...},"expansionParams":{...}}'
# Expected: pending_draft updated to phase=draft_ready — call_log: 1 entry (expansion, success)

# Accept → commits version + updates World Bible
curl -X POST http://localhost:3001/api/worlds/:wid/articles/:aid/accept
# Expected: new version committed, world_bible_entries updated

curl http://localhost:3001/api/worlds/:wid/bible/render
# Expected: article summary replaced with agent-generated summary
```

---

### Block 8 — CoherenceAgent + HistoryAgent + CompressionAgent

**What it builds:**
- `server/src/agents/coherence.ts` + `server/src/prompts/coherence.ts` → `POST /agents/cohere`
- `server/src/agents/history.ts` + `server/src/prompts/history.ts` → `POST /agents/history`
- `server/src/agents/compression.ts` + `server/src/prompts/compression.ts` → `POST /agents/compress`

Each uses the same tool-use loop from BaseAgent. Each has its own output tool.

**Depends on:** Block 7

**How to test:**
```bash
# Coherence: check an article against the World Bible
curl -X POST http://localhost:3001/api/worlds/:wid/agents/cohere \
  -d '{"articleId":":aid"}'
# Expected: { warnings: [...], suggestedLinks: [...] }

# History: backwards from a current event
curl -X POST http://localhost:3001/api/worlds/:wid/agents/history \
  -d '{"articleId":":aid","mode":"backwards","anchorDescription":"The collapse of Year 400","selectedProposal":{...},"expansionParams":{...}}'
# Expected: expansion + causalLinks[] + timelinePosition

# Compression: preview (not applied — apply per entry via PATCH /bible/:aid)
curl -X POST http://localhost:3001/api/worlds/:wid/agents/compress
# Expected: { entries: [{articleId, compressedSummary, tokensBefore, tokensAfter}] }
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
- `ArticlePage.tsx` — read-only article view (renders markdown via `@tailwindcss/typography`)
- `StatusBadge.tsx`, `WorldBibleMeter.tsx` (token count in topbar)

**Depends on:** Block 10 + Blocks 6 (skeleton agent)

**How to test:**
- Open app → WorldList shows existing worlds
- Click "New World" → wizard → submit → redirects to `/worlds/:wid`
- Sidebar shows 8 categories with stub articles
- Click an article → `/worlds/:wid/articles/:aid` → article body renders
- Search bar filters articles in sidebar
- World Bible token meter shows count from server

---

### Block 12 — TipTap Editor + Version History UI

**What it builds:**
- `ArticleEditor.tsx` — TipTap with markdown extension, read/write toggle
- `VersionHistoryPanel.tsx` — version list, preview, revert button
- `PATCH /api/worlds/:wid/articles/:aid` wired to editor save

**Depends on:** Block 11

**How to test:**
- Open an article → click "Edit" → TipTap editor appears with existing content
- Edit and save → version 2 created, topbar shows updated timestamp
- Open version history → two versions listed with timestamps + word counts
- Click "Preview" on v1 → shows old content
- Click "Revert to v1" → confirm dialog → v3 created with v1 content
- Prompt: "Update World Bible?" → confirm → World Bible meter updates

---

### Block 13 — Expansion Panel (Full MAS UI)

**What it builds:**
- `client/src/stores/expansionSlice.ts` — full 7-state phase machine
- `client/src/hooks/useExpansion.ts` — orchestrates all API calls
- `ExpansionPanel.tsx` — slide-over drawer, renders correct view per phase
- `ParameterForm.tsx` — word count, depth, breadth controls
- `TokenEstimate.tsx` — pre-call estimate display
- `ProposalCard.tsx` — 3-up proposal cards with select + refine
- `DraftReview.tsx` — inline TipTap editor on draft, accept/reject buttons

**Depends on:** Block 12 + Blocks 7 (proposal + expansion agents)

**How to test:**
- Open any article → click "Expand" → drawer opens at CONFIGURING phase
- Configure params → token estimate appears
- Click "Run Proposals" → loading state → 3 ProposalCard components appear
- Click "Refresh" 3 times → soft prompt appears after 3rd refresh
- Select a proposal + add refinement → click "Expand" → loading state → draft appears
- Edit draft inline → click "Accept" → article committed, drawer closes, version history updated
- Click "Reject" → back to proposal cards (no new LLM call)
- Close browser mid-draft → reopen → "Resume draft?" banner appears

---

### Block 14 — Timeline View + History Agent UI

**What it builds:**
- `TimelineView.tsx` — horizontal scrollable axis, event markers from articles with `temporal_anchor`
- `TimelineEvent.tsx` — event marker with popover (title, summary, link to article)
- History mode toggle (Backwards / Forwards) on ExpansionPanel when opened from timeline
- `POST /api/worlds/:wid/agents/history` wired to expansion flow

**Depends on:** Block 13

**How to test:**
- Navigate to `/worlds/:wid/timeline`
- Articles with temporal anchors appear as markers on the axis
- Click a marker → popover with summary + "Go to article" link
- Click "Add History Event" → ExpansionPanel opens with mode toggle visible
- Select "Backwards" mode + configure → run proposals → expand → accept → new event appears on timeline
- Forwards expansion warns when conflicting with a fixed-point event

---

### Block 15 — World Bible Editor + Usage Panel

**What it builds:**
- `WorldBibleEditor.tsx` — per-article summary list with inline editable text areas
- Compression Agent UI: "Compress Bible" button → preview diff → apply
- `client/src/hooks/useCallLog.ts`
- Usage panel page (`/worlds/:wid/usage`): call log table, daily counter, cost settings form
- `CoherenceWarningBanner.tsx` — shown on article page when open warnings exist

**Depends on:** Block 13 + Block 8 (coherence + compression agents)

**How to test:**
- Navigate to `/worlds/:wid/bible` → all article summaries listed, editable
- Edit a summary → token meter in topbar updates
- Click "Compress Bible" → preview shows before/after token counts → apply → summaries condensed
- Open an article with coherence warnings → banner shows warning descriptions + "Fix manually" / "Ignore"
- Navigate to `/worlds/:wid/usage` → call log table shows all past calls (agent type, tokens, status)
- Set daily cap to 3 → make 3 calls → 4th call blocked with warning

---

### Block 16 — Snapshots UI + Export + Final Polish

**What it builds:**
- Snapshots page (`/worlds/:wid/snapshots`) — list, create named snapshot, preview, restore
- Export button in topbar → downloads ZIP via `GET /worlds/:wid/export`
- `Toast.tsx` + `ConfirmDialog.tsx` — wired to all destructive/irreversible actions
- `shared/` wiring: all confirm dialogs (delete world, revert, restore snapshot, discard draft)

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
| 3 | Server | Article CRUD + versioning | curl edit/revert flow |
| 4 | Server | World Bible service | curl render, verify markdown output |
| 5 | Server | Token estimator + call log | curl estimate endpoint, check log |
| 6 | Server | SkeletonAgent + world creation | curl POST /worlds with seed |
| 7 | Server | ProposalAgent + ExpansionAgent | curl full Phase 1 → 2 → accept |
| 8 | Server | Coherence + History + Compression | curl each agent endpoint |
| 9 | Server | Snapshots + ZIP export | curl snapshot flow, download ZIP |
| 10 | Client | Routing + scaffolding | browser navigation, `tsc --noEmit` |
| 11 | Client | World creation + article browser | full creation flow in browser |
| 12 | Client | TipTap editor + version history | edit, revert in browser |
| 13 | Client | Expansion panel (MAS UI) | full Phase 1 → 2 flow in browser |
| 14 | Client | Timeline + History agent UI | timeline renders, history expansion |
| 15 | Client | World Bible editor + Usage panel | edit summaries, view call log |
| 16 | Client | Snapshots UI + Export + polish | snapshot/restore, ZIP download |
