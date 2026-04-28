# WorldArchitect

A local-first, single-user fiction world-building webapp. Build a Wikipedia-style encyclopedia for your fictional world, assisted by a Multi-Agent System (MAS) that generates and expands content — all fully usable without any LLM configured.

---

## Multi-Agent System

The MAS is composed of six specialized agents. Every agent call is a discrete, user-initiated HTTP POST — no agent auto-chains into another. Cost overruns are architecturally impossible.

### Agent Overview

```mermaid
flowchart TD
    User(["👤 User"])

    subgraph Creation ["World Creation"]
        SKA["SkeletonAgent\nGenerates initial article stubs\n(titles + summaries per category)"]
    end

    subgraph Expansion ["Article Expansion (Two-Phase)"]
        PA["ProposalAgent\nPhase 1 — returns 3 creative\ndirection proposals (~60 words each)"]
        EA["ExpansionAgent\nPhase 2 — writes full article content\nfrom selected proposal"]
    end

    subgraph Analysis ["Analysis & Maintenance"]
        CA["CoherenceAgent\nDetects contradictions and\nsuggests cross-links"]
        HA["HistoryAgent\nExpands historical events\n(backwards or forwards in time)"]
        CPA["CompressionAgent\nCondenses World Bible summaries\nwhen token count exceeds threshold"]
    end

    subgraph DB ["SQLite Database"]
        WB[("World Bible\n(world_bible_entries)")]
        ART[("Articles\n(article_versions)")]
        PD[("Pending Drafts\n(crash recovery)")]
    end

    User -->|"POST /agents/skeleton\n(on world creation)"| SKA
    SKA -->|"Writes stubs + summaries"| WB

    User -->|"POST /agents/propose\n(Phase 1)"| PA
    PA -->|"Returns Proposal[3]\n(session only, not persisted)"| User
    User -->|"Selects proposal\nPOST /articles/:aid/draft"| PD

    User -->|"POST /agents/expand\n(Phase 2)"| EA
    EA -->|"Returns draft + warnings + links"| PD
    User -->|"POST /articles/:aid/accept"| ART
    ART -->|"Upserts summary"| WB

    User -->|"POST /agents/cohere\n(optional)"| CA
    CA -->|"Returns warnings + link suggestions"| User

    User -->|"POST /agents/history\n(from Timeline view)"| HA
    HA -->|"Returns expanded event\n+ causal links"| PD

    User -->|"POST /agents/compress\n(manual trigger)"| CPA
    CPA -->|"Returns compressed summaries\n→ applied via PATCH /bible/:aid"| WB
```

### Agent Tool-Use Pattern

Every agent interacts with the world through a typed tool-use loop — never raw JSON prompts.

```mermaid
sequenceDiagram
    participant R as Route Handler
    participant B as BaseAgent
    participant P as LLM Provider
    participant D as SQLite DB

    R->>B: run(input)
    B->>P: complete(messages, contextTools + outputTool)

    loop Up to 6 iterations
        P-->>B: stopReason = 'tool_use'

        alt Context tool called (read-only)
            B->>D: get_world_bible() / get_article() / search_articles() / get_timeline()
            D-->>B: DB result
            B->>P: complete(messages + tool_result)
        else Output tool called
            B-->>B: Extract typed result, exit loop
        end
    end

    B->>D: logCall(agent_type, tokens_in, tokens_out, status)
    B-->>R: AgentResult<TOutput>
```

**Context tools** (read-only DB reads — called on demand during reasoning):

| Tool | Returns |
|---|---|
| `get_world_bible()` | Full Bible rendered as `## Category / ### Title / summary` markdown |
| `get_article(articleId)` | Article body, summary, metadata |
| `search_articles(query)` | Articles matching keyword (title + body) |
| `get_timeline(worldId)` | Articles with temporal anchors, sorted chronologically |

**Output tools** (one per agent — calling it ends the loop):

| Tool | Agent |
|---|---|
| `submit_stubs(stubs[])` | SkeletonAgent |
| `submit_proposals(proposals[3])` | ProposalAgent |
| `submit_expansion(body, summary, warnings[], links[], anchor?)` | ExpansionAgent |
| `submit_coherence_check(warnings[], links[])` | CoherenceAgent |
| `submit_history_expansion(body, summary, causalLinks[], timelinePosition)` | HistoryAgent |
| `submit_compression(entries[])` | CompressionAgent |

### Expansion Phase State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> CONFIGURING : openPanel(articleId)

    CONFIGURING --> ESTIMATING : estimateTokens()
    ESTIMATING --> CONFIGURING : token estimate returned

    CONFIGURING --> LOADING_PROPOSALS : runProposals()
    LOADING_PROPOSALS --> PROPOSALS_READY : ProposalAgent returns 3 proposals

    PROPOSALS_READY --> LOADING_PROPOSALS : refreshProposals()
    PROPOSALS_READY --> LOADING_DRAFT : selectProposal() + runExpansion()

    LOADING_DRAFT --> DRAFT_READY : ExpansionAgent returns draft

    DRAFT_READY --> IDLE : acceptDraft() → commit to DB
    DRAFT_READY --> PROPOSALS_READY : rejectDraft()
```

---

## Architecture

```
WorldArchitect/
├── client/          # React 18 + Vite + TypeScript (Blocks 10–16)
├── server/          # Node.js + Express + TypeScript (Blocks 1–9)
├── data/            # Created at runtime
│   └── worldarchitect.db
├── docs/
└── package.json     # npm workspaces root
```

**Start:** `npm run dev` (starts server on :3001 and client on :5173 via `concurrently`)

### Providers

The app works with `provider = none` — all data routes function normally; agent routes return `503`. When a provider is configured, keys are stored locally and never returned unmasked.

| Provider | Tool calling |
|---|---|
| Anthropic | Native (`tools` param) |
| OpenAI | Native (`tools` param) |
| Groq | Native (`tools` param) |
| Ollama | Prompt-based JSON fallback (model-dependent) |

---

## Build Status

| Block | Layer | Description | Status |
|---|---|---|---|
| 1 | Server | Monorepo + SQLite + health check | ✅ Done |
| 2 | Server | World & Category CRUD | ✅ Done |
| 3 | Server | Article CRUD + versioning + drafts | ✅ Done |
| 4 | Server | World Bible service + routes | ✅ Done |
| 5 | Server | Provider abstraction + call logger + settings | ✅ Done |
| 6 | Server | BaseAgent (tool-use loop) + SkeletonAgent | ✅ Done |
| 7 | Server | Creator + Redactor + CoherenceAgent + RetentionAgent | 🔲 Next |
| 8 | Server | Historian + BibleCompressor | 🔲 Pending |
| 9 | Server | Snapshots + ZIP export | 🔲 Pending |
| 10–16 | Client | Full React frontend | 🔲 Pending |

See [`docs/build_blocks.md`](docs/build_blocks.md) for detailed checklists per block.
