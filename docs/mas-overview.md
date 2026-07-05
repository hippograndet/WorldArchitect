# Multi-Agent System Overview

WorldArchitect's Multi-Agent System, or MAS, is an optional creative assistant for building and maintaining a fictional encyclopedia.

It is not required to use the app. You can create, edit, version, snapshot, and export worlds without any LLM provider configured.

## Core Principle

The MAS is designed around user control. Agents can propose, draft, summarize, check, or reorganize content, but important changes are reviewed by the user before they become part of the world.

Forge is the exception: it is an optional automation mode for recursively expanding article trees. It should be used when you want faster generation and are comfortable reviewing the results afterward.

Internally, Spark and Forge are not separate agent systems. They are different policies over the same MAS:

- **Spark** is article-scoped, manual, and review-before-commit.
- **Forge** is subtree-scoped, automatic, and review-after-generation.
- **World Tools** are world-scoped and proposal/review oriented.

The shared contract is location, intent, autonomy mode, review policy, and commit policy. This keeps future agent workflows modular while making it clear when the system should ask the user, create a pending draft, or commit automatically.

## Main Entry Points

### Spark

Spark is the creation flow on an article. It can:

- Improve or derive an introduction
- Generate creative proposals
- Expand an article description
- Suggest child articles
- Continue from one step to the next

Spark is best when you want help growing an article while still choosing the direction.

![Spark inception flow](assets/Screenshot_Spark_Inception.png)

Spark usually starts by asking what kind of work you want to do. For a new or empty article, inception can help establish a usable foundation. For an existing article, Spark can propose expansion directions so you can pick the creative angle before any draft is written.

![Spark expansion direction selection](assets/Screenshot_Spark_Expansion_Direction_Selection.png)

Spark can also propose child subjects when an article should branch into a richer hierarchy. This is useful for turning a broad concept into connected people, places, factions, events, or ideas while preserving user review.

![Spark branching suggestions](assets/Screenshot_Spark_Branching.png)

### Solidify

Solidify is for cleanup and review. It can:

- Reorganize rough article prose
- Check for coherence issues
- Preserve facts during cleanup
- Surface style or consistency warnings

Solidify is best after an article already has useful material but needs structure or polish.

### Forge

Forge automates expansion across an article subtree. It can run inception, expansion, and branching over multiple articles using breadth-first or depth-first traversal.

Forge runs on the server as a resumable run with progress logs, pause, resume, and stop controls. It is powerful, but because it can auto-accept generated drafts, it is best used on stubs or experimental branches of a world.

### World Tools

World-level tools review the encyclopedia as a graph. They can look for missing links, conceptual gaps, and broad consistency issues.

## What The Agents Do

WorldArchitect uses specialized agents for different jobs:

- **Architect** creates initial article stubs during world creation.
- **Muse** proposes creative directions.
- **Curator** can select a proposal automatically.
- **Oracle** suggests thematic ideas.
- **Researcher** extracts constraints from existing context before drafting.
- **Scribe** writes article descriptions.
- **Continuity Editor** checks draft contradictions before acceptance.
- **Lorekeeper** writes compact World Bible introductions.
- **Cartographer** proposes child articles.
- **Warden** checks coherence against the world.
- **Sentinel** checks that reorganized text did not lose facts.
- **Style Warden** reviews tone and prose fit.
- **Linter** finds article issues after saves.
- **Fixer** helps resolve individual issues.
- **Chronicler** writes chronology sections.
- **Auditor** reviews the world graph.
- **Condenser** shortens overly long World Bible entries.
- **Stylist** expands world style notes into more useful writing guidance.

## Cost And Safety Controls

WorldArchitect is intentionally explicit about AI use:

- Agent routes are disabled when no provider is configured.
- Calls are logged.
- Daily caps can be configured.
- Drafts can be reviewed before commit in normal workflows.
- Version history makes accepted changes reversible.
- Snapshots can preserve an entire world before large operations.

The goal is not to replace the writer. The goal is to make a complex fictional world easier to grow, inspect, and maintain.

## Context Package Boundary

Agents receive curated article context from the server rather than reading the database directly. Today, that package contains the target article, parents, siblings, children, fixed points, temporal neighbors, referenced articles, and an estimated token budget.

The context package boundary keeps agent workflows modular: agents consume one curated package instead of many low-level database, vector, and metadata tools.
