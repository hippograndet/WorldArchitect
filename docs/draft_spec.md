# WorldArchitect — Product Specification (v3)

**Status:** Approved  
**Date:** 2026-04-25

---

## 1. Core Goal

A local-first, single-user web application for fiction world-building: users seed a world, then iteratively generate a Wikipedia-style encyclopedia through a structured, cost-conscious multi-agent system that requires explicit user approval at every meaningful decision point.

---

## 2. Acceptance Criteria

---

### A. Data & Storage

- [ ] All world data is persisted locally (browser IndexedDB or a local file-system via a lightweight backend process, e.g. a local Node/Python server writing JSON/SQLite)
- [ ] No account, login, or cloud sync required
- [ ] On first launch, the app creates a local data directory; its path is shown in Settings
- [ ] A manual "Export World" function writes the entire world to a portable ZIP of Markdown files

**Versioning**
- [ ] Every time an article is accepted (committed), the previous version is stored — not replaced
- [ ] Each article has a version history panel showing: version number, timestamp, word count, and the expansion parameters used to generate it
- [ ] The user can preview any past version and revert to it in one click
- [ ] Reverting creates a new version entry (revert is non-destructive; it does not delete newer versions)
- [ ] The user can create a named World Snapshot: a tagged checkpoint of the entire encyclopedia state (e.g., "Pre-war draft", "v1 complete")
- [ ] World Snapshots can be restored in full or browsed without overwriting the current state

---

### B. World Creation & Encyclopedia

- [ ] User creates a World with: name, free-text description (≥ 20 chars), optional inspiration tags, optional tone/style setting (Academic / Narrative / Terse / Custom)
- [ ] User can attach seed files (txt, md, max 500 KB each) or paste text snippets
- [ ] On world creation, the system generates a skeleton of stubs across 8 default categories: Religion, Technology, Politics, Economy, Culture, Geography, History, Notable Figures
- [ ] Categories can be added, renamed, reordered, or hidden
- [ ] Each article carries: title, category, status (`stub` / `draft` / `reviewed`), temporal anchor (optional), body, cross-links, version history
- [ ] v1 ships 5 hardcoded article templates: General, Character Profile, Location, Faction, Historical Event
- [ ] A sidebar lists all articles grouped by category; a search bar filters by title or keyword
- [ ] The History category has a dedicated timeline view (horizontal scrollable axis with event markers)

---

### C. Multi-Agent System

The MAS is the core of the product. It is composed of discrete, single-purpose agents. No agent automatically triggers another. Every inter-agent transition requires an explicit user action.

#### Agent Roster

| Agent | Responsibility | Approx. call size |
|---|---|---|
| **Skeleton Agent** | On world creation: generates category stubs from seed inputs | Medium (seed + prompt) |
| **Proposal Agent** | Phase 1: returns 3 brief creative directions for a given subject | Small |
| **Expansion Agent** | Phase 2: writes full article from approved proposal + parameters | Medium–Large |
| **Coherence Agent** | Checks a draft against the World Bible; returns warnings + suggested links | Small–Medium |
| **History Agent** | Specialized expansion for timeline events; handles backwards/forwards modes | Medium |
| **Compression Agent** | Triggered manually: re-summarizes the World Bible when it grows too large | Medium |

#### World Bible

- [ ] The World Bible is a system-maintained document of all article *summaries* (not full bodies), updated each time an article is accepted
- [ ] It is the sole context document passed to all agents — full article bodies are never sent
- [ ] The World Bible has a visible token counter in the UI; when it exceeds a configurable threshold (default: 80 000 tokens), a warning banner appears
- [ ] The user can manually trigger the Compression Agent to re-summarize the World Bible into a shorter form (with preview before applying)
- [ ] The user can also manually edit the World Bible directly (plain text editor), bypassing any agent call

#### Expansion Flow (Two-Phase)

**Pre-call: Parameter Panel**
- [ ] Before any LLM call, the user configures:
  - Word count target (Short ~300w / Medium ~700w / Long ~1500w / Custom ≥50w)
  - Detail depth (Surface / Detailed / Exhaustive)
  - Chronological depth (None / Shallow / Deep — how far back/forward to reach)
  - Breadth (Focused / Connected — whether to weave in adjacent topics)
- [ ] An estimated token cost is displayed before confirming (calculated from parameter set + current World Bible size)
- [ ] The user must click "Run" to initiate any call

**Phase 1 — Proposal Agent**
- [ ] Returns 3 proposals: each is a title + ~60-word summary of a distinct creative direction
- [ ] The user can: select one, select one and add written refinements, or discard all and refresh (new batch)
- [ ] Each refresh re-runs Phase 1 only; it does not trigger Phase 2
- [ ] After 3 consecutive refreshes with no selection, the app prompts: "Consider adding more detail to your seed or parameters"
- [ ] Proposals are stored in session history so the user can go back to a previous batch

**Phase 2 — Expansion Agent**
- [ ] Fires only after a proposal is explicitly confirmed
- [ ] Receives: selected proposal text, user refinements (if any), expansion parameters, World Bible, article template schema
- [ ] Returns structured output: `{ article_content, coherence_warnings[], suggested_links[], temporal_anchor? }`
- [ ] Draft is displayed for review; not committed until the user clicks "Accept"
- [ ] The user can edit the draft inline before accepting
- [ ] The user can reject the draft (returns to proposal selection, no new LLM call)
- [ ] Accepting commits the article and updates the World Bible

**Phase 3 — Coherence Agent (optional, user-triggered)**
- [ ] Can be run on any draft or accepted article at any time
- [ ] Returns: list of contradictions with named source articles, severity (Warning / Conflict), and a plain-English description
- [ ] Each coherence issue offers: "Fix manually" (opens both articles for inline editing) or "Ignore" (marks as intentional)
- [ ] No automatic LLM fix is offered — manual resolution is the default to avoid cascading calls

#### History Agent — Specialized Flow

- [ ] Accessible from the Timeline view or from any article with a temporal anchor
- [ ] Two modes:
  - **Backwards:** user defines a current-state condition → agent reverse-engineers plausible prior events
  - **Forwards:** user defines an earlier event/snapshot → agent derives logical consequences forward
- [ ] Both modes go through the standard two-phase Propose → Expand flow
- [ ] Output includes: temporal anchor range, causal links to existing articles, timeline position marker
- [ ] Forwards expansion warns if it would overwrite or contradict a user-defined "fixed point" event

---

### D. Cost Controls & Failsafes

- [ ] **Pre-call token estimate:** shown before every agent invocation; user can cancel
- [ ] **World Bible token meter:** always visible in the sidebar; color-coded (green / amber / red)
- [ ] **Call log:** every LLM call is logged locally with: timestamp, agent type, estimated tokens in/out, result status (success / error / rejected by user). Viewable in a "Usage" panel
- [ ] **Daily call counter:** optional soft cap the user can configure (e.g., max 20 calls/day); shows a warning when approaching the limit, hard-blocks when reached (user can override once per session)
- [ ] **No auto-chaining:** no agent ever triggers another agent automatically; every transition is a user action
- [ ] **Phase 1 before Phase 2 is always enforced:** Phase 2 cannot run without a confirmed proposal
- [ ] **Partial failure recovery:** if Phase 2 times out or errors, the confirmed proposal is preserved; the user retries without re-running Phase 1
- [ ] **Manual edit escape hatch:** every article can be written or edited entirely by hand, bypassing all agents. The user can promote a manual edit to a World Bible update without any LLM call
- [ ] **Coherence check is opt-in:** surfaced as a suggested action after expansion, not a blocking gate
- [ ] **Compression is manual and previewed:** the Compression Agent never fires automatically; the user sees a diff of the World Bible before and after compression and can cancel

---

## 3. Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|---|---|
| Phase 1 call fails | Toast error; panel state preserved; user retries |
| Phase 2 call times out | Preserve confirmed proposal; allow retry; no partial commit |
| LLM returns malformed JSON | Display raw text; flag article "Needs manual review"; do not auto-commit |
| World Bible exceeds token threshold | Warning banner; Compression Agent button highlighted; expansion still allowed but user is informed |
| Backwards history goes before world's defined origin | Warn: "Expansion predates world origin. Proceed?" — user confirms or cancels |
| Forwards history conflicts with a fixed-point event | Coherence warning listing both events; user resolves manually |
| User sets Custom word count below 50 | Inline validation error; call blocked |
| User refreshes proposals 3+ times | Soft prompt to add more specificity |
| Revert to old article version | New version entry created; World Bible not auto-updated — user prompted: "Update World Bible to reflect this version?" |
| World Snapshot restore | Confirmation dialog listing how many articles will change; non-destructive (current state saved as a snapshot first) |
| App closed mid-draft | Draft + selected proposal saved to local storage; restored on next open with a "Resume draft?" banner |
| Local storage quota exceeded | Warning before write; prompt to export and clean up old snapshots |
| Seed input is contradictory | Surfaced as a coherence warning at skeleton generation; user decides how to resolve |

---

## 4. Scope Cuts for v1

**Cut 1 — Custom article template editor**
Ship 5 hardcoded templates. User-defined schemas are v2.

**Cut 2 — Compression Agent auto-suggestions**
World Bible compression is entirely manual and user-initiated. No smart "you should compress now" recommendations — just the token meter and a button.
