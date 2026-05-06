# WorldArchitect — MAS System Overview

The Multi-Agent System (MAS) is an optional layer that generates and refines world-building content. It never writes directly to the database. Every output is held in a pending draft that the user must explicitly accept or discard.

---

## Agents

| Agent | File | Role |
|---|---|---|
| **SkeletonAgent** | `agents/skeleton.ts` | Generates initial article stubs (title + intro) for a new world |
| **ProposalAgent** | `agents/proposal.ts` | Produces 3 distinct creative directions for the user to choose from |
| **TasteAgent** | `agents/taste.ts` | Selects the best proposal automatically based on world style (auto-select mode) |
| **ExpanderAgent** | `agents/expander.ts` | Writes the `## Description` section from a chosen proposal |
| **SummarizerAgent** | `agents/summarizer.ts` | Derives a 1-paragraph Introduction from a Description (`full`), or polishes an existing intro as a seed (`improve`) |
| **ChildProposerAgent** | `agents/childProposer.ts` | Proposes 10 child article stubs under a parent |
| **CoherenceAgent** | `agents/coherence.ts` | Detects factual contradictions between new content and the World Bible |
| **RetentionAgent** | `agents/retention.ts` | Verifies that a reorganized Description preserved all facts |
| **ChroniclerAgent** | `agents/chronicler.ts` | Writes the `## Chronology` section for an article |
| **BibleCompressorAgent** | `agents/bibleCompressor.ts` | Compresses World Bible entries to reduce token count (preview only) |
| **PromptEngineerAgent** | `agents/promptEngineer.ts` | Expands a short user-written style field (vibe, writing style, inspiration) into a rich LLM-ready brief |

All agents extend `BaseAgent` (`agents/base.ts`) which implements a tool-use loop (max 6 iterations). Agents use two categories of tools:
- **Context tools** (read-only DB reads): `get_world_bible`, `get_article`, `search_articles`, `get_timeline`
- **Output tools** (structured result submission): one per agent (`submit_description`, `submit_proposals`, etc.)

---

## Pipelines

A pipeline is a named sequence of agent calls triggered by a single user action. The `PipelineCoordinator` class (`agents/director.ts`) owns all pipelines.

### `expand_description` / `create_root` / `create_child`

The primary content-generation pipeline.

```
User selects task → ProposalAgent → [TasteAgent if auto-select] → User picks proposal
→ ExpanderAgent → [SummarizerAgent if create_child] → pending_draft saved → User reviews → Accept / Discard
```

- **ProposalAgent** generates 3 directions. The user picks one (or TasteAgent picks automatically).
- **ExpanderAgent** writes the `## Description` section. For `create_child` it also writes `parentAppend` text to be appended to the parent article.
- **SummarizerAgent** only runs for `create_child` (new article needs a World Bible intro). For `expand_description`, the existing Introduction is preserved unchanged.
- Draft is persisted to `pending_drafts` before the response is sent. Commit via `POST /articles/:aid/accept`.

### `expand_chronology`

```
User triggers → ChroniclerAgent → CoherenceAgent → pending_draft saved → User reviews → Accept / Discard
```

- **ChroniclerAgent** writes the `## Chronology` section.
- **CoherenceAgent** checks the new chronology content for contradictions.
- Coherence warnings are shown in the review panel but do not block acceptance.

### `reorganize`

```
User triggers (no proposal step) → ExpanderAgent [reorganize mode] → RetentionAgent → SummarizerAgent → pending_draft saved → User reviews → Accept / Discard
```

- The current Description is passed as a read-only constraint. The ExpanderAgent restructures without adding or removing facts.
- **RetentionAgent** flags any facts that appear to have been lost.
- **SummarizerAgent** derives a new Introduction from the reorganized Description.

### `propose_children`

```
User triggers → ChildProposerAgent → User selects stubs → POST /articles/batch (no draft)
```

- No pending draft. Selected stubs are batch-created immediately.

### `summarize` / `improve_intro`

```
User triggers → SummarizerAgent (full or improve mode) → User reviews → Commit to World Bible
```

- `full` mode: derives Introduction from the existing `## Description`.
- `improve` mode: treats the user's current Introduction as a creative seed and polishes it.
- Committed via `PATCH /bible/:aid` (no `pending_drafts` involved).

### `cohere`

```
User triggers → CoherenceAgent → User reviews warnings (display only, nothing to commit)
```

### `compress`

```
User triggers → BibleCompressorAgent → Preview shown → User selects entries → PATCH /bible/:aid per entry
```

Preview only. No pending draft. User applies entries individually.

### World creation

```
POST /worlds (Step 1) → World created with real ID
→ User configures style (Step 2) → [PromptEngineerAgent per field] → PATCH /worlds/:wid
→ Optional: POST /agents/skeleton → SkeletonAgent → batch article stubs created
```

---

## Context Assembly (`services/archivist.ts`)

Before each agent run the `buildContextPackage()` function assembles a structured snapshot of the article's neighbourhood from the database. Context depth is controlled by the `contextDepth` parameter:

| Depth | Token budget | What's included |
|---|---|---|
| `shallow` | 1 500 | Direct parents (intro only). No siblings, children, or fixed points. |
| `mid` (default) | 6 000 | All relation tiers, intro only for each. |
| `deep` | 12 000 | L1 relations (parents, children, siblings) include full `## Description` if budget allows. L2+ intro only. |

Tiers assembled (when budget allows): parents → children → siblings → fixed points → temporal neighbours → referenced articles.

---

## World Style Context (`prompts/shared.ts`)

Every agent system prompt begins with `buildWorldHeader(worldContext)` which renders:

```
World: **{name}**
Tone: {tone description}
Vibe & Atmosphere: {vibe}
Writing Style: {writingStyle}
Inspiration — {name}: {expandedDescription}
...
Constraints: {originPoint}
```

`styleConfig` is populated at world creation (Step 2 wizard) and editable in World Settings. The PromptEngineerAgent expands short user-written style fields into detailed LLM-ready briefs.

---

## Data Flow

### Pending Draft Lifecycle

```
POST /agents/expand      → saves to pending_drafts (draft_content JSON, pipeline_type)
POST /articles/:aid/accept → reads pending_drafts, writes new article_version, updates World Bible
DELETE /articles/:aid/draft → discards pending_drafts row
GET /articles/:aid/draft → crash recovery: restores panel from persisted draft
```

The `pending_drafts` table is keyed on `article_id` (one draft per article at a time). On accept, the draft row is deleted and a new `article_versions` row is created.

### Call Logging

Every agent run (success or error) inserts a row in `call_log` with: `world_id`, `agent_type`, `tokens_in`, `tokens_out`, `status`. This powers the Usage panel and the per-world daily cap check.

### World Bible Updates

The World Bible (`world_bible_entries`) stores one introduction paragraph per article. It is updated:
- On `POST /articles/:aid/accept` for pipelines that produce an introduction (`create_child`)
- On `PATCH /bible/:aid` for standalone summarize / improve_intro / compress acceptance

The materialized token count (`world_bible_meta`) is recomputed after each update.

---

## User Interaction Surface

All AI features are accessed through the **AI Agent Panel** — a fixed right-side drawer opened from any article page. The panel is never forced.

### Phase State Machine

```
idle → configuring → generating → [proposals_ready] → expanding → reviewing → continuing → idle
                                ↘ (auto-select)    ↗
```

| Phase | What the user sees |
|---|---|
| `configuring` | Task selector, parameters (length, detail depth, breadth, context depth, auto-select toggle, focus/constraints) |
| `generating` | Spinner. ProposalAgent / direct agent running. |
| `proposals_ready` | 3 proposal cards with editable direction text. User picks one and clicks "Expand Selected". |
| `expanding` | Spinner. ExpanderAgent running. |
| `reviewing` | Draft preview (Description and/or Introduction). Accept / Discard. |
| `continuing` | "What's next?" suggestion cards (Expand Chronology, Propose Subsections, Coherence Check, etc.) |
| `error` | Error message + retry. |

### Parameters (AgentConfigView)

| Parameter | Type | Applies to |
|---|---|---|
| Task | Pipeline selector | All |
| Length | short / medium / long | Expand, Create Child, Reorganize, Summarize |
| Detail depth | surface / detailed / exhaustive | Proposal pipelines |
| Breadth | focused / connected | Proposal pipelines |
| Context depth | shallow / mid / deep | All except Coherence Check |
| Auto-select | toggle | Proposal pipelines |
| Focus / constraints | free text | Most pipelines |

### Post-Accept Continuation

After accepting a draft, the panel transitions to `continuing` and suggests logical next steps based on what was just completed:

| Completed | Suggested next |
|---|---|
| Expand Description / Create Child / Reorganize | Expand Chronology, Propose Subsections |
| Expand Chronology | Propose Subsections, Coherence Check |
| Summarize / Improve Intro | Expand Description |
| Propose Subsections | Coherence Check |
