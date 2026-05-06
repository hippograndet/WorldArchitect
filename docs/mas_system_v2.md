# WorldArchitect — MAS System v2

This document describes the MAS architecture after the Spark / Solidification / Forge redesign. The backend (agents, tools, routes) is unchanged from v1. All changes are in the frontend layer: the UI entry points, the client-side state machine, and the new recursive Forge automation.

---

## What Changed

| Aspect | v1 | v2 |
|---|---|---|
| UI entry point | Single "AI Agent" button → flat task list | "✦ Spark" + "⚙ Solidify" buttons → scoped panels |
| Configuration view | One `AgentConfigView` with all 10 task types | `SparkConfigView` (3 creation tasks) + `SolidificationConfigView` (2 cleanup tasks) |
| Task prerequisite gates | None (any task always available) | Expansion requires ≥15-word intro; Branching requires ≥15-word intro and ≥40-word description |
| Sequential chaining | Manual (ContinuationView suggestions only) | Optional auto-chain across Inception→Expansion→Branching |
| Recursive automation | None | Recursive Forge: automated full-pipeline BFS or DFS traversal of an article subtree |
| World overview | Auto-redirect to first article | Real dashboard: article stats, Bible token meter, Audit World trigger |

---

## UI Entry Points

### ✦ Spark (per-article creation)

Opened from any article page. Covers three sequential creation tasks:

| Task | Pipeline called | Prerequisite |
|---|---|---|
| **Inception** | `summarize` (`improve` mode if intro exists, else `full`) | None — always available |
| **Expansion** | `forge_expand` (full Muse→Oracle→Scribe→Lorekeeper chain) | Introduction ≥ 15 words |
| **Branching** | `propose_children` | Introduction ≥ 15 words AND description ≥ 40 words |

All three tasks share: Context Depth selector, "Include current content" toggle, "Auto-chain all steps" toggle, and a free-text Guidance field.

Task-specific params:
- **Expansion**: paragraph count preset (Short = 3 §, Medium = 5 §, Long = 7 §)
- **Branching**: type selector (Conceptual categories — default, or Specific named instances)

The Branching type injects a hint prefix into `userSpec` before the API call:
- Conceptual → `"Prefer conceptual categories and systems. <user guidance>"`
- Specific → `"Prefer specific named instances (individual entities, real examples). <user guidance>"`

### ⚙ Solidify (per-article cleanup)

Opened from the same article page via a second button. Covers two cleanup tasks:

| Task | Pipeline | Description |
|---|---|---|
| **Reorganize** | `reorganize` | Restructure existing description (RetentionAgent safety check included) |
| **Coherence Check** | `cohere` | Detect contradictions with the World Bible (display only, nothing to commit) |

Shared params: Context Depth selector + Guidance textarea (Guidance hidden for Coherence Check).

### World Overview (world-level tools)

Replaced the former auto-redirect with a stats dashboard:
- Article count grid: Total / Stubs / Drafts / Reviewed (computed from `treeNodes`)
- World Bible token meter (purple → amber → red as threshold approached)
- **Audit World** button → calls `startAudit(wid)` which fires `POST /agents/audit` immediately (no configuring phase), shows results in `AuditResultView`

---

## Phase State Machine (updated)

```
idle → configuring → generating → [proposals_ready] → expanding → reviewing → [continuing] → idle
                                ↘ (auto-select TasteAgent) ↗
                                                          ↓ autoChain=true: skip continuing
                 forging ──────────────────────────────── forge_done
```

New phases:

| Phase | What the user sees |
|---|---|
| `forging` | `ForgeProgressView`: progress bar, current article/step, Pause/Resume/Stop controls, scrollable activity log |
| `forge_done` | Same view with green progress bar and completion message |
| `continuing` | Still shown when `autoChain=false`. Skipped when `autoChain=true` in Spark mode. |

---

## Auto-Chain Logic (Spark mode)

When `agentPanelMode === 'spark'` and `agentParams.autoChain === true`, after a user accepts a draft in `agentCommit`:

1. After **Inception** (`summarize`): auto-start Expansion — set `agentPipelineType = 'forge_expand'`, reset state, call `runAgentGenerate(worldId)` directly
2. After **Expansion** (`forge_expand`): auto-start Branching — set `agentPipelineType = 'propose_children'`, call `runAgentGenerate(worldId)`
3. After **Branching**: close panel

Intermediate review UIs (ProposalSelectorView, IdeaSelectorView, DraftReviewView, ChildProposalSelectorView) **still show** — the user reviews and approves each step. Only the ContinuationView "what's next?" gate is skipped.

`suggestNextSteps` for Spark chain:
- `summarize` → `[{ label: 'Expand Description', pipeline: 'forge_expand' }]`
- `forge_expand` → `[{ label: 'Branch Children', pipeline: 'propose_children' }]`
- `propose_children` → `[]`

---

## Recursive Forge

The Forge is a fully automated multi-article pipeline. The user enables it from the Spark config panel. When enabled, the Spark CTA becomes "⚙ Start Forge" (amber) and `startForge(wid)` is called instead of `runAgentGenerate`.

### What it does per article

For each item in the queue, the forge runs these steps without user interaction:

1. **Inception** — `POST /agents/summarize` (`mode: 'improve'`) → commit via `PATCH /bible/:aid`
2. **Expansion** — `POST /agents/propose` with `autoSelect: true` (TasteAgent picks best proposal) → `POST /agents/expand` → commit via `POST /articles/:aid/accept`
3. **Branching** (if `item.depth < maxDepth`) — `POST /agents/propose-children` → `POST /articles/batch` → add new child IDs to queue

Per-item errors are logged and the loop continues with the next item.

### Traversal strategies

Controlled by `forgeMode: 'breadth' | 'depth'`:

```
Breadth-first (push):      Depth-first (unshift):
  Root                       Root
  ├── A ← process 1st        ├── A ← process 1st
  ├── B ← process 2nd        │   ├── A1 ← process 2nd
  └── C ← process 3rd        │   └── A2 ← process 3rd (after A1's children)
      ├── B1 ← 4th           ├── B ← later
      └── B2 ← 5th           └── C ← later
```

Implementation: a shared `forgeQueue: ForgeItem[]` array. BFS uses `push(...newItems)`, DFS uses `unshift(...newItems)`.

### Forge parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `forgeEnabled` | boolean | false | Master toggle |
| `forgeMode` | `'breadth' \| 'depth'` | `'breadth'` | Traversal strategy |
| `forgeMaxDepth` | number | 1 | How many levels deep to branch (0 = current article only) |
| `forgeMaxChildren` | number | 5 | Max children to create per article (0 = no limit) |

Estimated scope displayed in UI: `1 + N + N² + ... + N^maxDepth` where N = `forgeMaxChildren`.

### Pause / Resume / Stop

- **Pause** — sets `forgePaused = true`; the loop checks this flag at the start of each iteration and breaks. The queue and progress state are preserved.
- **Resume** — clears `forgePaused`, re-enters `runForgeLoop(wid)` from the current queue head.
- **Stop** — sets `forgeRunning = false`, clears queue, sets phase to `'forge_done'`.

### Activity log

`forgeLog: ForgeLogEntry[]` accumulates one entry per completed step:
```typescript
interface ForgeLogEntry {
  articleId: string;
  title: string;
  step: 'Inception' | 'Expansion' | 'Branching';
  ok: boolean;
  error?: string;
}
```
Displayed in `ForgeProgressView` with step icons: ★ (Inception), ↑ (Expansion), ⤆ (Branching).

### Forge runtime state fields

```typescript
forgeRunning: boolean;
forgePaused: boolean;
forgeQueue: ForgeItem[];
forgeLog: ForgeLogEntry[];
forgeCurrentTitle: string | null;
forgeCurrentStep: string | null;
forgeCompleted: number;
forgeTotal: number;
```

---

## Agent Roster

All agents are unchanged. Listed here for reference with their v2 UI context:

| Agent | Role | Triggered by |
|---|---|---|
| **SkeletonAgent** | Generates initial article stubs for a new world | World creation wizard |
| **ProposalAgent** | 3 creative direction proposals | Spark: Expansion (manual select) |
| **TasteAgent** | Auto-selects best proposal from world style | Spark: Expansion (auto-select); Forge: Expansion step |
| **ExpanderAgent** | Writes `## Description` | Spark: Expansion; Solidify: Reorganize; Forge: Expansion step |
| **SummarizerAgent** | Derives 1-paragraph Introduction | Spark: Inception; post-Expansion (create_child); Solidify: Reorganize; Forge: Inception step |
| **ChildProposerAgent** | Proposes 10 child article stubs | Spark: Branching; Forge: Branching step |
| **CoherenceAgent** | Detects contradictions vs World Bible | Solidify: Coherence Check; also runs post-expand and post-chronology |
| **RetentionAgent** | Verifies fact preservation during reorganize | Solidify: Reorganize |
| **ChroniclerAgent** | Writes `## Chronology` section | ArticlePage: Expand Chronology (via ContinuationView or direct) |
| **BibleCompressorAgent** | Compresses World Bible entries (preview only) | TopBar: Bible page → Compress |
| **PromptEngineerAgent** | Expands style field text into LLM-ready brief | World creation wizard + World Settings |

---

## Pipelines

### Spark: Inception

```
User clicks "Start Inception" → POST /agents/summarize (mode: 'improve' or 'full')
→ reviewing phase → User accepts → PATCH /bible/:aid
```

`mode` selection: if `includeCurrentContent=true` (default) and an intro exists → `'improve'`; otherwise `'full'`.

### Spark: Expansion (`forge_expand`)

```
User clicks "Start Expansion" → POST /agents/propose (pipelineType: 'expand_description')
→ proposals_ready (ProposalSelectorView) → [IdeaSelectorView if Oracle ideas returned]
→ POST /agents/expand → reviewing (DraftReviewView) → User accepts → POST /articles/:aid/accept
```

Auto-select path (TasteAgent): `proposals_ready` phase is skipped; TasteAgent selects the best proposal from the world style context.

### Spark: Branching (`propose_children`)

```
User clicks "Start Branching" → POST /agents/propose-children (userSpec prefixed with type hint)
→ proposals_ready (ChildProposalSelectorView) → User selects stubs → POST /articles/batch
```

No pending draft. Created child IDs are returned immediately by batch endpoint.

### Solidify: Reorganize

```
POST /agents/reorganize → RetentionAgent → SummarizerAgent → pending_draft
→ reviewing (DraftReviewView with retention issues shown) → User accepts → POST /articles/:aid/accept
```

### Solidify: Coherence Check

```
POST /agents/cohere → reviewing (warnings display only — nothing to commit)
```

### Audit (World Overview)

```
POST /agents/audit → reviewing (AuditResultView: edge proposals + global warnings)
→ User accepts individual edges → POST /agents/audit/accept-edge per accepted edge
```

Bypasses `configuring` phase — `startAudit(wid)` jumps directly to `generating`.

### Forge (Recursive Automation)

```
User configures in SparkConfigView → "⚙ Start Forge" → forging phase
→ runForgeLoop: per article: Inception → Expansion (auto-select) → Branching
→ forge_done
```

All intermediate agent calls are fully automated. No user interaction until the loop completes.

---

## Context Assembly (unchanged from v1)

`services/archivist.ts → buildContextPackage()` assembles context tiers before each agent call.

| Depth | Budget | Included |
|---|---|---|
| `shallow` | 1 500 tokens | Direct parents (intro only) |
| `mid` (default) | 6 000 tokens | All relation tiers, intro only |
| `deep` | 12 000 tokens | L1 relations with full `## Description` if budget allows |

---

## Data Flow

### Pending Draft Lifecycle (unchanged)

```
POST /agents/expand (or /reorganize)  → saves to pending_drafts
POST /articles/:aid/accept            → new article_version created, draft deleted
DELETE /articles/:aid/draft           → discard
GET /articles/:aid/draft              → crash recovery
```

### Forge Draft Flow

In forge mode, `POST /articles/:aid/accept` is called programmatically after each Expansion step. No `pending_drafts` row persists across forge iterations — each item's draft is immediately accepted.

### World Bible Updates

Updated after:
- `POST /articles/:aid/accept` for pipelines producing an introduction (`create_child`, `forge_expand`)
- `PATCH /bible/:aid` for standalone Inception / improve intro / compress acceptance
- Direct write in Forge Inception step via `PATCH /bible/:aid`

---

## World Style Context (unchanged)

`prompts/shared.ts → buildWorldHeader(worldContext)` prepended to every agent system prompt:

```
World: **{name}**
Tone: {tone description}
Vibe & Atmosphere: {vibe}
Writing Style: {writingStyle}
Inspiration — {name}: {expandedDescription}
Constraints: {originPoint}
```

PromptEngineerAgent expands short user-written style fields into detailed LLM-ready briefs during world creation and in World Settings.

---

## Client State Fields Summary

New fields added to `agentSlice` in v2:

```typescript
// Mode
agentPanelMode: 'spark' | 'solidification';

// AgentParams additions
branchingMode?: 'conceptual' | 'specific';
includeCurrentContent: boolean;    // default true
autoChain: boolean;                // default false
forgeEnabled: boolean;             // default false
forgeMode: 'breadth' | 'depth';   // default 'breadth'
forgeMaxDepth: number;             // default 1
forgeMaxChildren: number;          // default 5

// Forge runtime state
forgeRunning: boolean;
forgePaused: boolean;
forgeQueue: ForgeItem[];
forgeLog: ForgeLogEntry[];
forgeCurrentTitle: string | null;
forgeCurrentStep: string | null;
forgeCompleted: number;
forgeTotal: number;
```

New `AgentPhase` values: `'forging'`, `'forge_done'`.

New `openAgentPanel` signature:
```typescript
openAgentPanel(
  articleId: string | null,
  articleTitle: string | null,
  mode: 'spark' | 'solidification',
  pipeline?: PipelineType,
): void
```

New `startAudit(worldId: string)`: opens panel, sets phase to `'generating'`, fires audit immediately.

New `startForge(worldId: string)`: builds initial queue `[{ articleId, title, depth: 0 }]`, sets `forgeRunning = true`, transitions phase to `'forging'`, enters `runForgeLoop`.
