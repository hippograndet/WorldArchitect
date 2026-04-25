# WorldArchitect — Architecture Document (v1)

**Status:** Awaiting Approval  
**Date:** 2026-04-25  
**Spec ref:** [docs/draft_spec.md](./draft_spec.md)

---

## 1. Overview

WorldArchitect is a **local-first monorepo** with two packages:

| Package | Role | Port |
|---|---|---|
| `client/` | React + Vite SPA | 5173 (dev) |
| `server/` | Node.js + Express API | 3001 |

The browser has no direct access to the filesystem or LLM — all persistence and agent calls go through the local Express server. The user starts the app with a single `npm run dev` at the root (using npm workspaces + `concurrently`).

```
WorldArchitect/
├── client/                  # React frontend
├── server/                  # Express backend
├── docs/
├── data/                    # Created at runtime
│   └── worldarchitect.db    # SQLite database file
├── package.json             # Root workspace
└── CLAUDE.md
```

---

## 2. Tech Stack

### Core choices

| Concern | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Fast dev, no SSR needed, x86 compatible |
| Routing | `react-router-dom` v6 | Deep-linkable URLs, browser back/forward, article cross-links |
| Backend | Node.js + Express | Minimal, synchronous SQLite works cleanly |
| Storage | SQLite via `better-sqlite3` | File-based, WAL mode, transactions for versioning, no daemon |
| LLM | `@anthropic-ai/sdk` | Official TS SDK, structured output, token counting API |
| State | Zustand + Immer (slices pattern) | Lightweight, no boilerplate, server is source of truth |
| Editor | TipTap + `@tiptap/extension-markdown` | Headless, markdown-native, extensible |
| Styling | Tailwind CSS + `@tailwindcss/typography` | Wikipedia-style prose rendering out of the box |
| Validation | Zod | LLM output parsing + API input validation |
| Export | `jszip` | ZIP of Markdown files, no native alternative |
| IDs | `nanoid` | Compact, URL-safe, no dependency on `uuid` |

### Intentionally excluded

| Excluded | Replaced by |
|---|---|
| Axios | Native `fetch` |
| Lodash | Native JS (ES2022+) |
| Date libraries | Native `Date` + `Intl` |
| Docker | Local Node process |
| ORM | Raw `better-sqlite3` prepared statements |

---

## 3. Project File Structure

```
client/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx          # Root layout: sidebar + main area
│   │   │   ├── Sidebar.tsx           # Category tree + article list + search
│   │   │   ├── TopBar.tsx            # World name, snapshot button, usage panel trigger
│   │   │   └── WorldBibleMeter.tsx   # Token counter badge (green/amber/red)
│   │   ├── world/
│   │   │   ├── WorldList.tsx         # Home screen: list of worlds
│   │   │   └── WorldCreationWizard.tsx
│   │   ├── article/
│   │   │   ├── ArticlePage.tsx       # Full article view
│   │   │   ├── ArticleEditor.tsx     # TipTap editor (read/write modes)
│   │   │   ├── VersionHistoryPanel.tsx
│   │   │   └── CoherenceWarningBanner.tsx
│   │   ├── expansion/
│   │   │   ├── ExpansionPanel.tsx    # Drawer: params → proposals → draft review
│   │   │   ├── ParameterForm.tsx     # Word count, depth, breadth sliders
│   │   │   ├── TokenEstimate.tsx     # Pre-call cost estimate display
│   │   │   ├── ProposalCard.tsx      # One of 3 proposal cards
│   │   │   └── DraftReview.tsx       # Inline diff + accept/reject
│   │   ├── timeline/
│   │   │   ├── TimelineView.tsx      # Horizontal scrollable axis
│   │   │   └── TimelineEvent.tsx     # Event marker + popover
│   │   ├── bible/
│   │   │   └── WorldBibleEditor.tsx  # Plain text editor for manual edits
│   │   └── shared/
│   │       ├── Toast.tsx
│   │       ├── ConfirmDialog.tsx
│   │       └── StatusBadge.tsx       # stub / draft / reviewed
│   ├── stores/
│   │   ├── index.ts                  # Combined bound store
│   │   ├── worldSlice.ts
│   │   ├── articleSlice.ts
│   │   ├── expansionSlice.ts         # Phase state machine
│   │   └── uiSlice.ts
│   ├── hooks/
│   │   ├── useExpansion.ts           # Orchestrates Phase 1 → Phase 2 flow
│   │   ├── useCoherence.ts
│   │   ├── useVersionHistory.ts
│   │   └── useCallLog.ts
│   ├── lib/
│   │   └── api.ts                    # Typed fetch wrappers for all endpoints
│   ├── types/
│   │   ├── world.ts
│   │   ├── article.ts
│   │   ├── agent.ts
│   │   └── expansion.ts
│   ├── routes.tsx                    # react-router-dom route definitions
│   ├── App.tsx
│   └── main.tsx
│
server/
├── src/
│   ├── db/
│   │   ├── index.ts                  # DB singleton, WAL mode, init
│   │   └── schema.ts                 # CREATE TABLE statements
│   ├── agents/
│   │   ├── base.ts                   # BaseAgent: Anthropic client, call logger, error wrapper
│   │   ├── skeleton.ts
│   │   ├── proposal.ts
│   │   ├── expansion.ts
│   │   ├── coherence.ts
│   │   ├── history.ts
│   │   └── compression.ts
│   ├── prompts/
│   │   ├── skeleton.ts
│   │   ├── proposal.ts
│   │   ├── expansion.ts
│   │   ├── coherence.ts
│   │   ├── history.ts
│   │   └── compression.ts
│   ├── routes/
│   │   ├── worlds.ts
│   │   ├── articles.ts
│   │   ├── agents.ts                 # All /agents/* endpoints
│   │   ├── bible.ts
│   │   ├── snapshots.ts
│   │   ├── callLog.ts
│   │   └── export.ts
│   ├── services/
│   │   ├── worldBible.ts             # Build + update World Bible from article summaries
│   │   ├── tokenEstimator.ts         # Pre-call token estimate (count_tokens API)
│   │   ├── callLogger.ts             # Write to call_log table
│   │   ├── exporter.ts               # Build ZIP via jszip
│   │   └── drafts.ts                 # Pending draft persistence + recovery
│   └── index.ts                      # Express app entry point
```

---

## 4. Database Schema

All timestamps are Unix milliseconds (INTEGER). JSON fields store serialized arrays/objects.

```sql
CREATE TABLE worlds (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  tags        TEXT,          -- JSON: string[]
  tone        TEXT NOT NULL DEFAULT 'narrative',
  origin_point TEXT,         -- optional temporal anchor for world start
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE articles (
  id                   TEXT PRIMARY KEY,
  world_id             TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  category_id          TEXT NOT NULL REFERENCES categories(id),
  title                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'stub',   -- stub|draft|reviewed
  template_type        TEXT NOT NULL DEFAULT 'general',
  temporal_anchor_start TEXT,
  temporal_anchor_end   TEXT,
  is_fixed_point       INTEGER NOT NULL DEFAULT 0,
  current_version_id   TEXT,   -- FK set after first version insert
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE article_versions (
  id                       TEXT PRIMARY KEY,
  article_id               TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_number           INTEGER NOT NULL,
  body                     TEXT NOT NULL,    -- Markdown
  summary                  TEXT NOT NULL,    -- ~100 words, World Bible entry
  expansion_params         TEXT,             -- JSON: ExpansionParams | null (manual edits)
  proposal_used            TEXT,             -- JSON: Proposal | null
  word_count               INTEGER NOT NULL DEFAULT 0,
  is_revert                INTEGER NOT NULL DEFAULT 0,
  reverted_from_version_id TEXT,
  created_at               INTEGER NOT NULL
);

CREATE TABLE article_links (
  source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  PRIMARY KEY (source_article_id, target_article_id)
);

CREATE TABLE coherence_warnings (
  id               TEXT PRIMARY KEY,
  article_id       TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_article_id TEXT REFERENCES articles(id),
  severity         TEXT NOT NULL,   -- warning|conflict
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',  -- open|accepted|resolved
  created_at       INTEGER NOT NULL
);

-- World Bible: one row per article summary (structured storage).
-- Rendered to markdown text when passed to LLM context.
-- Token cost difference vs plain text: ~35-50 tokens/article (~$0.005/call for 50 articles).
-- Benefit: targeted per-article UPDATE, relevance-sorted context rendering, exact ID cross-referencing.
CREATE TABLE world_bible_entries (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  article_id  TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,       -- ~100 words, manually editable
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- category sort order for rendering
  updated_at  INTEGER NOT NULL
);

-- Materialized token count for the full world bible (updated on every entry change)
CREATE TABLE world_bible_meta (
  world_id    TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  token_count INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE world_snapshots (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,  -- JSON: full article + version dump
  created_at INTEGER NOT NULL
);

CREATE TABLE call_log (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_type    TEXT NOT NULL,
  article_id    TEXT REFERENCES articles(id),
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  status        TEXT NOT NULL,  -- success|error|rejected
  error_message TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE pending_drafts (
  id               TEXT PRIMARY KEY,
  article_id       TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  selected_proposal TEXT NOT NULL,  -- JSON: Proposal
  draft_content    TEXT,            -- null until Phase 2 completes
  expansion_params TEXT NOT NULL,   -- JSON: ExpansionParams
  phase            TEXT NOT NULL,   -- proposal_selected|draft_ready
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE cost_settings (
  world_id       TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  daily_cap      INTEGER,           -- null = no cap
  bible_threshold INTEGER NOT NULL DEFAULT 80000
);
```

---

## 5. Client Route Structure

```
/                                     → WorldList (home screen)
/worlds/:wid                          → World overview (encyclopedia index)
/worlds/:wid/articles/:aid            → ArticlePage (read + expand)
/worlds/:wid/articles/:aid/edit       → ArticleEditor (manual edit mode)
/worlds/:wid/timeline                 → TimelineView
/worlds/:wid/bible                    → WorldBibleEditor
/worlds/:wid/snapshots                → Snapshots list + restore
/worlds/:wid/usage                    → Call log + cost settings
```

`AppShell` wraps all `/worlds/:wid/*` routes and renders the sidebar + topbar.  
The Expansion Panel is a slide-over drawer rendered on top of any article route — no dedicated route needed.  
Article cross-links rendered by TipTap use `<Link to="/worlds/:wid/articles/:aid">` via a custom TipTap mark.

---

## 6. Data Flow

### 5a. World Creation
```
User fills WorldCreationWizard
  → POST /api/worlds  (name, description, tags, tone, seedText, seedFiles)
    → server validates input (Zod)
    → creates worlds row
    → creates 8 default categories rows
    → creates stub articles rows (titles only, empty body)
    → calls SkeletonAgent (one LLM call)
      → agent receives: seed + category list
      → returns: stub titles + summaries per category
    → inserts article_versions rows (summary only, body = summary)
    → inserts world_bible_entries rows (one per stub, sorted by category)
    → recalculates world_bible_meta.token_count via count_tokens API
    → logs call
  ← returns: World + articles + World Bible token count
```

### 5b. Expansion Flow (Two-Phase)
```
User opens ExpansionPanel on an article
  → configures ExpansionParams in ParameterForm
  → GET /api/worlds/:id/agents/estimate-tokens  (params + bible size)
    ← estimated token count displayed
  → clicks "Run Proposals"
    → POST /api/worlds/:id/agents/propose
      → server calls ProposalAgent (Phase 1)
        → receives: article context + params + World Bible
        → returns: Proposal[3]
      → stores proposals in memory (not persisted — cheap, session-only)
      → logs call
    ← 3 ProposalCard components rendered

User selects a proposal (optionally adds refinements)
  → POST /api/worlds/:id/articles/:aid/draft  (saves pending_drafts row, phase=proposal_selected)
  → clicks "Expand"
    → POST /api/worlds/:id/agents/expand
      → server calls ExpansionAgent (Phase 2)
        → receives: selected proposal + refinements + params + World Bible + template
        → returns: { article_content, summary, coherence_warnings, suggested_links, temporal_anchor? }
      → updates pending_drafts row (draft_content set, phase=draft_ready)
      → logs call
    ← DraftReview component rendered with inline editor

User accepts draft
  → POST /api/worlds/:id/articles/:aid/accept
    → server begins SQLite transaction:
      → inserts new article_versions row (version_number++)
      → updates articles.current_version_id
      → updates articles.status to 'draft'
      → upserts article_links from suggested_links
      → inserts coherence_warnings (if any)
      → upserts world_bible_entries row for this article (summary from agent output)
      → updates world_bible_meta.token_count
      → deletes pending_drafts row
    → transaction commits
  ← returns: updated Article + WorldBible token count
```

### 5c. Revert Flow
```
User selects version in VersionHistoryPanel
  → POST /api/worlds/:id/articles/:aid/revert/:vid
    → server reads target version's body + summary
    → inserts new article_versions row:
        body = target body, is_revert = 1, reverted_from_version_id = vid
    → updates articles.current_version_id (non-destructive)
  ← returns: new ArticleVersion
  → client prompts: "Update World Bible to reflect this version?"
    → if yes: PATCH /api/worlds/:id/bible/:article_id  (updates that entry's summary)
```

### 5d. World Bible Manual Edit
```
User edits WorldBibleEditor (plain textarea)
  → PATCH /api/worlds/:id/bible  { content: string }
    → server updates world_bible.content
    → re-counts tokens via Anthropic count_tokens API
    → updates world_bible.token_count
  ← returns: updated token_count
```

---

## 6. Agent Design — Tool-Use Pattern

Agents use the provider's native **tool/function calling** API rather than prompting for raw JSON. This is safer, more reliable across all providers, and gives the agent the ability to fetch context on demand.

### Two tool categories

**Context tools (read-only)** — agents call these to fetch data during their reasoning:

| Tool | Returns |
|---|---|
| `get_world_bible()` | Rendered Bible markdown for the current world |
| `get_article(articleId)` | Article body, summary, metadata |
| `search_articles(query)` | Articles matching keyword (title + body search) |
| `get_timeline(worldId)` | Articles with temporal anchors, sorted chronologically |

**Output tools (structured result)** — one per agent type; calling this ends the loop:

| Tool | Agent | Key inputs |
|---|---|---|
| `submit_stubs(stubs[])` | SkeletonAgent | title, categoryName, summary, templateType |
| `submit_proposals(proposals[3])` | ProposalAgent | title + ~60-word summary each |
| `submit_expansion(...)` | ExpansionAgent | body, summary, coherenceWarnings[], suggestedLinks[], temporalAnchor? |
| `submit_coherence_check(...)` | CoherenceAgent | warnings[], suggestedLinks[] |
| `submit_history_expansion(...)` | HistoryAgent | All expansion fields + causalLinks[], timelinePosition |
| `submit_compression(entries[])` | CompressionAgent | articleId + compressedSummary per entry |

### BaseAgent tool-use loop

```
1. Build messages: [system prompt, user request message]
2. Call provider.complete(messages, options, contextTools + outputTool)
3. If stopReason = 'tool_use':
     For each tool call:
       a. Validate input with Zod (throw on invalid)
       b. If context tool: execute DB read, append result to messages
       c. If output tool: extract result, exit loop
     Loop back to step 2
4. Log call (agent_type, tokensIn, tokensOut, status)
5. Return typed output
```

Max iterations: **6** (prevents runaway loops). If the output tool is not called within 6 turns → log error, return structured error to client.

### Safety rules
- Context tools are **read-only** — no DB writes inside the agent loop
- All tool inputs validated with Zod before execution
- `requireLLM` middleware blocks all `/agents/*` routes when provider = `none`
- Daily cap checked **before** the agent runs (not inside the loop)
- Partial failure: if the call errors or times out, `pending_drafts` preserves the selected proposal so Phase 1 is not re-run

### Provider tool-use compatibility

| Provider | Tool calling | JSON mode fallback |
|---|---|---|
| Anthropic | Native (`tools` param) | N/A |
| OpenAI | Native (`tools` param) | `response_format: json_object` |
| Groq | Native (`tools` param) | `response_format: json_object` |
| Ollama | Model-dependent | Prompt-based JSON extraction + Zod parse |

For Ollama, `BaseAgent` falls back to prompt-based JSON when the model doesn't support tool calling — the output tool schema is embedded in the system prompt as a JSON example.

---

## 6b. Agent Shared Types

```typescript
// types/expansion.ts
type WordCountPreset = 'short' | 'medium' | 'long' | 'custom';
type DetailDepth = 'surface' | 'detailed' | 'exhaustive';
type ChronologicalDepth = 'none' | 'shallow' | 'deep';
type Breadth = 'focused' | 'connected';

interface ExpansionParams {
  wordCountPreset: WordCountPreset;
  wordCountCustom?: number;       // required when preset = 'custom'
  detailDepth: DetailDepth;
  chronologicalDepth: ChronologicalDepth;
  breadth: Breadth;
}

// types/agent.ts
type ArticleTemplate = 'general' | 'character' | 'location' | 'faction' | 'historical_event';
type AgentType = 'skeleton' | 'proposal' | 'expansion' | 'coherence' | 'history' | 'compression';

interface AgentContext {
  worldId: string;
  worldName: string;
  worldTone: string;
  // Rendered markdown string built from world_bible_entries rows,
  // sorted by category (same category as target article first, then rest).
  // Format: "## Category\n### Article Title\nsummary\n\n..."
  worldBible: string;
}

interface AgentResult<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
}

interface Proposal {
  title: string;
  summary: string;              // ~60 words
}

interface CoherenceWarning {
  sourceArticleId: string | null;
  sourceArticleTitle: string | null;
  severity: 'warning' | 'conflict';
  description: string;
}

interface SuggestedLink {
  targetArticleTitle: string;
  targetArticleId: string | null;  // null if article doesn't exist yet
}

interface TemporalAnchor {
  start: string;
  end?: string;
}
```

### Agent Signatures

```typescript
// agents/base.ts
abstract class BaseAgent<TInput, TOutput> {
  protected client: Anthropic;
  protected logger: CallLogger;

  abstract run(input: TInput): Promise<AgentResult<TOutput>>;
  protected abstract buildPrompt(input: TInput): MessageParam[];
  protected abstract parseResponse(raw: string): TOutput;
  protected handleError(error: unknown): never;
}

// agents/skeleton.ts
interface SkeletonInput {
  context: Omit<AgentContext, 'worldBible'>;  // no bible yet
  seedText: string;
  seedFiles: string[];                         // file contents as strings
  categories: string[];
}

interface SkeletonOutput {
  stubs: Array<{
    title: string;
    categoryName: string;
    summary: string;
    templateType: ArticleTemplate;
  }>;
  coherenceWarnings: CoherenceWarning[];
}

class SkeletonAgent extends BaseAgent<SkeletonInput, SkeletonOutput> {}

// agents/proposal.ts
interface ProposalInput {
  context: AgentContext;
  articleTitle: string;
  articleCategory: string;
  templateType: ArticleTemplate;
  expansionParams: ExpansionParams;
  existingBody?: string;         // if article already has content, for re-expansion
  userSpecifications?: string;
}

interface ProposalOutput {
  proposals: [Proposal, Proposal, Proposal];
}

class ProposalAgent extends BaseAgent<ProposalInput, ProposalOutput> {}

// agents/expansion.ts
interface ExpansionInput {
  context: AgentContext;
  articleTitle: string;
  articleCategory: string;
  templateType: ArticleTemplate;
  selectedProposal: Proposal;
  userRefinements?: string;
  expansionParams: ExpansionParams;
}

interface ExpansionOutput {
  articleContent: string;          // Markdown
  summary: string;                 // ~100 words, for World Bible
  coherenceWarnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
  temporalAnchor?: TemporalAnchor;
}

class ExpansionAgent extends BaseAgent<ExpansionInput, ExpansionOutput> {}

// agents/coherence.ts
interface CoherenceInput {
  context: AgentContext;
  articleId: string;
  articleTitle: string;
  articleContent: string;
}

interface CoherenceOutput {
  warnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
}

class CoherenceAgent extends BaseAgent<CoherenceInput, CoherenceOutput> {}

// agents/history.ts
interface HistoryInput extends ExpansionInput {
  mode: 'backwards' | 'forwards';
  anchorDescription: string;     // the event to reason from
  existingTimeline: Array<{
    title: string;
    summary: string;
    temporalAnchor: TemporalAnchor;
    isFixedPoint: boolean;
  }>;
}

interface HistoryOutput extends ExpansionOutput {
  causalLinks: Array<{
    articleId: string;
    articleTitle: string;
    relation: 'causes' | 'follows' | 'context';
  }>;
  timelinePosition: TemporalAnchor;
}

class HistoryAgent extends BaseAgent<HistoryInput, HistoryOutput> {}

// agents/compression.ts
interface CompressionInput {
  context: Omit<AgentContext, 'worldBible'>;
  currentBible: string;
}

interface CompressionOutput {
  compressedBible: string;
  tokensBefore: number;
  tokensAfter: number;
}

class CompressionAgent extends BaseAgent<CompressionInput, CompressionOutput> {}
```

---

## 7. REST API Endpoints

All routes are prefixed `/api`. All request/response bodies are JSON. Errors return `{ error: string }`.

### Worlds
```
POST   /worlds                           Create world + run SkeletonAgent
GET    /worlds                           List all worlds (id, name, updatedAt)
GET    /worlds/:wid                      Full world object
PATCH  /worlds/:wid                      Update name/description/tone/tags
DELETE /worlds/:wid                      Delete world + all data
```

### Categories
```
GET    /worlds/:wid/categories           List categories (ordered)
POST   /worlds/:wid/categories           Create category
PATCH  /worlds/:wid/categories/:cid      Rename / reorder / hide
DELETE /worlds/:wid/categories/:cid      Delete category
```

### Articles
```
GET    /worlds/:wid/articles             List articles (filter: category, status, search)
POST   /worlds/:wid/articles             Create article manually (no agent)
GET    /worlds/:wid/articles/:aid        Article + current version body
PATCH  /worlds/:wid/articles/:aid        Manual edit (creates new version, increments number)
DELETE /worlds/:wid/articles/:aid        Delete article

GET    /worlds/:wid/articles/:aid/versions       Full version history list
GET    /worlds/:wid/articles/:aid/versions/:vid  Preview one version (body only)
POST   /worlds/:wid/articles/:aid/revert/:vid    Revert to version (creates new version)
```

### Drafts
```
GET    /worlds/:wid/articles/:aid/draft         Get pending draft (for crash recovery)
DELETE /worlds/:wid/articles/:aid/draft         Discard pending draft
POST   /worlds/:wid/articles/:aid/accept        Accept draft, commit article + update Bible
```

### World Bible
```
GET    /worlds/:wid/bible                Get all entries (rendered markdown + token_count)
PATCH  /worlds/:wid/bible/:aid           Edit one article's summary (recounts tokens)
GET    /worlds/:wid/bible/render         Get the full rendered markdown string (for preview)
```

### Snapshots
```
GET    /worlds/:wid/snapshots            List snapshots (id, name, createdAt)
POST   /worlds/:wid/snapshots            Create named snapshot
GET    /worlds/:wid/snapshots/:sid       Preview snapshot (article list only, no full bodies)
POST   /worlds/:wid/snapshots/:sid/restore  Restore snapshot (saves current state first)
DELETE /worlds/:wid/snapshots/:sid       Delete snapshot
```

### Agents
```
POST   /worlds/:wid/agents/estimate      Estimate token cost (no LLM call — uses count_tokens API)
POST   /worlds/:wid/agents/skeleton      Run SkeletonAgent (world creation only)
POST   /worlds/:wid/agents/propose       Run ProposalAgent (Phase 1)
POST   /worlds/:wid/agents/expand        Run ExpansionAgent (Phase 2)
POST   /worlds/:wid/agents/cohere        Run CoherenceAgent (optional, user-triggered)
POST   /worlds/:wid/agents/history       Run HistoryAgent (from timeline)
POST   /worlds/:wid/agents/compress      Run CompressionAgent (returns compressed summaries — apply via PATCH /bible/:aid per entry)
```

### Usage & Settings
```
GET    /worlds/:wid/call-log             Paginated call log (timestamp, agent, tokens, status)
GET    /worlds/:wid/settings             Cost settings (daily_cap, bible_threshold)
PATCH  /worlds/:wid/settings             Update cost settings
```

### Export
```
GET    /worlds/:wid/export               Stream ZIP file (one .md per article)
```

---

## 8. Zustand Store Slices

```typescript
// stores/worldSlice.ts
interface WorldSlice {
  worlds: World[];
  currentWorldId: string | null;
  loadWorlds: () => Promise<void>;
  selectWorld: (id: string) => void;
  createWorld: (input: CreateWorldInput) => Promise<World>;
  deleteWorld: (id: string) => Promise<void>;
}

// stores/articleSlice.ts
interface ArticleSlice {
  articles: Article[];           // all articles for current world
  currentArticleId: string | null;
  versions: ArticleVersion[];    // versions for current article
  selectArticle: (id: string) => void;
  loadArticles: (worldId: string) => Promise<void>;
  loadVersions: (articleId: string) => Promise<void>;
  acceptDraft: (articleId: string) => Promise<void>;
  revertToVersion: (articleId: string, versionId: string) => Promise<void>;
  manualEdit: (articleId: string, body: string) => Promise<void>;
}

// stores/expansionSlice.ts
type ExpansionPhase =
  | 'idle'
  | 'configuring'
  | 'estimating'
  | 'loading_proposals'
  | 'proposals_ready'
  | 'loading_draft'
  | 'draft_ready';

interface ExpansionSlice {
  phase: ExpansionPhase;
  targetArticleId: string | null;
  params: ExpansionParams;
  tokenEstimate: number | null;
  proposalBatches: Proposal[][];  // history of all batches for this session
  currentBatchIndex: number;
  selectedProposal: Proposal | null;
  userRefinements: string;
  draft: ExpansionDraft | null;
  refreshCount: number;

  openPanel: (articleId: string) => void;
  closePanel: () => void;
  updateParams: (params: Partial<ExpansionParams>) => void;
  estimateTokens: () => Promise<void>;
  runProposals: () => Promise<void>;
  refreshProposals: (specifications?: string) => Promise<void>;
  selectProposal: (proposal: Proposal) => void;
  setRefinements: (text: string) => void;
  runExpansion: () => Promise<void>;
  rejectDraft: () => void;
}

// stores/uiSlice.ts
interface UISlice {
  toasts: Toast[];
  confirmDialog: ConfirmDialogState | null;
  sidebarOpen: boolean;
  activeView: 'encyclopedia' | 'timeline' | 'bible' | 'usage';
  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  showConfirm: (state: ConfirmDialogState) => void;
  dismissConfirm: () => void;
  setActiveView: (view: UISlice['activeView']) => void;
}
```

---

## 9. Expansion Phase State Machine

```
IDLE
 │  openPanel(articleId)
 ▼
CONFIGURING
 │  estimateTokens()
 ▼
ESTIMATING ─── (count_tokens API call, no content generated) ───► CONFIGURING
 │  runProposals()
 ▼
LOADING_PROPOSALS
 │  ← ProposalAgent returns 3 proposals
 ▼
PROPOSALS_READY
 │  refreshProposals()  ──────────────────────────────► LOADING_PROPOSALS
 │  selectProposal() + runExpansion()
 ▼
LOADING_DRAFT
 │  ← ExpansionAgent returns draft
 ▼
DRAFT_READY
 │  acceptDraft()              rejectDraft()
 ▼                             ▼
(committed → IDLE)        PROPOSALS_READY
```

---

## 10. Dependencies

### Root `package.json`
```json
{
  "workspaces": ["client", "server"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w server\" \"npm run dev -w client\""
  },
  "devDependencies": {
    "concurrently": "^9.x"
  }
}
```

### `client/package.json`
```json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router-dom": "^6.x",
    "zustand": "^5.x",
    "immer": "^10.x",
    "@tiptap/react": "^2.x",
    "@tiptap/starter-kit": "^2.x",
    "@tiptap/extension-markdown": "^2.x",
    "nanoid": "^5.x",
    "jszip": "^3.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^6.x",
    "@vitejs/plugin-react": "^4.x",
    "tailwindcss": "^4.x",
    "@tailwindcss/typography": "^0.5.x"
  }
}
```

### `server/package.json`
```json
{
  "dependencies": {
    "express": "^4.x",
    "@anthropic-ai/sdk": "^0.x",
    "better-sqlite3": "^12.x",
    "zod": "^3.x",
    "nanoid": "^5.x",
    "jszip": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/express": "^4.x",
    "@types/better-sqlite3": "^7.x",
    "tsx": "^4.x"
  }
}
```

---

## 11. Key Architectural Decisions & Trade-offs

**1. Local Express server vs. pure browser (IndexedDB)**  
`better-sqlite3` requires Node.js (native bindings). This gives us real transactions, WAL mode, and a proper versioning model. The trade-off is that the user must run a terminal command to start the app — acceptable for a solo developer tool.

**2. LLM-free by default**  
All data operations (create, edit, version, revert, Bible edits) work without any LLM configured. Agent routes return `503` with a friendly message when `provider = 'none'`. World creation always works — it creates 8 empty stubs, and the SkeletonAgent fills them in only when an LLM is configured.

**3. Multi-provider via single abstraction**  
`LLMProvider` interface with two implementations: `AnthropicProvider` (uses `@anthropic-ai/sdk`) and `OpenAICompatibleProvider` (uses `openai` with custom `baseURL`, covers OpenAI, Groq, and Ollama). Switching providers preserves all stored keys. Keys are stored in a singleton `provider_settings` row and never returned unmasked to the client.

**4. Agents use tool calling, not JSON prompts**  
Agents interact with the world through a defined set of typed tools: read-only context tools (DB queries) and one output tool per agent type. The `BaseAgent` runs a tool-use loop with a max-iterations cap. This is safer than prompt-based JSON extraction and more reliable across providers.

**5. No auto-chaining between agents**  
Every agent call is a discrete HTTP POST. No agent triggers another automatically. Cost overruns are architecturally impossible.

**6. World Bible: structured DB, rendered to markdown for LLM**  
Summaries stored per-article in `world_bible_entries` (targeted SQL updates). Rendered to `## Category / ### Title / summary` markdown when passed to agents. Context tools let agents fetch the Bible or specific articles on demand during the tool-use loop.

**7. React Router v6 for navigation**  
Every view gets a deep-linkable URL. Article cross-links in TipTap render as `<Link>` components.

**8. Proposals stored in Zustand (not DB)**  
Proposals are ephemeral. Only the *selected* proposal is persisted in `pending_drafts` for crash recovery. Regenerating 3 proposals is cheap if the session ends.

---

## 12. Implementation Status

### Server — complete (Blocks 1–5)
```
server/src/db/index.ts             ✅ SQLite singleton, WAL, FK, schema
server/src/db/schema.ts            ✅ 13 tables + provider_settings seed
server/src/providers/types.ts      ✅ LLMProvider interface + Tool types
server/src/providers/anthropic.ts  ✅ AnthropicProvider
server/src/providers/openai.ts     ✅ OpenAICompatibleProvider (OpenAI/Groq/Ollama)
server/src/providers/index.ts      ✅ getProvider(), requireLLM, maskKey
server/src/services/worldBible.ts  ✅ upsertEntry, renderBible, getEntries, getBibleMeta
server/src/services/callLogger.ts  ✅ logCall, checkDailyCap, getDailyCallCount
server/src/services/tokenEstimator.ts ✅ estimateCallTokens, updateBibleTokenCount
server/src/routes/worlds.ts        ✅
server/src/routes/categories.ts    ✅
server/src/routes/articles.ts      ✅ CRUD + versions + revert + drafts + accept
server/src/routes/bible.ts         ✅
server/src/routes/settings.ts      ✅ global provider + per-world cost
server/src/routes/callLog.ts       ✅
server/src/index.ts                ✅ all routes mounted
```

### Server — to build (Blocks 6–9)
```
server/src/tools/context.ts        context tools (read-only DB)
server/src/tools/output.ts         output tools (one per agent type)
server/src/agents/base.ts          BaseAgent tool-use loop
server/src/agents/skeleton.ts
server/src/agents/proposal.ts
server/src/agents/expansion.ts
server/src/agents/coherence.ts
server/src/agents/history.ts
server/src/agents/compression.ts
server/src/prompts/*.ts            one prompt file per agent
server/src/routes/agents.ts        all /agents/* endpoints + estimate
server/src/routes/snapshots.ts
server/src/routes/export.ts
```

### Client — to build (Blocks 10–16)
All of `client/` — React + Vite scaffolding not yet started.
