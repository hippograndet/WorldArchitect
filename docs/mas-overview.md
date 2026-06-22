# Multi-Agent System Overview

WorldArchitect's Multi-Agent System, or MAS, is an optional creative assistant for building and maintaining a fictional encyclopedia.

It is not required to use the app. You can create, edit, version, snapshot, and export worlds without any LLM provider configured.

## Core Principle

The MAS is designed around user control. Agents can propose, draft, summarize, check, or reorganize content, but important changes are reviewed by the user before they become part of the world.

Forge is the exception: it is an optional automation mode for recursively expanding article trees. It should be used when you want faster generation and are comfortable reviewing the results afterward.

## Main Entry Points

### Spark

Spark is the creation flow on an article. It can:

- Improve or derive an introduction
- Generate creative proposals
- Expand an article description
- Suggest child articles
- Continue from one step to the next

Spark is best when you want help growing an article while still choosing the direction.

### Solidify

Solidify is for cleanup and review. It can:

- Reorganize rough article prose
- Check for coherence issues
- Preserve facts during cleanup
- Surface style or consistency warnings

Solidify is best after an article already has useful material but needs structure or polish.

### Forge

Forge automates expansion across an article subtree. It can run inception, expansion, and branching over multiple articles using breadth-first or depth-first traversal.

Forge is powerful, but because it can auto-accept generated drafts, it is best used on stubs or experimental branches of a world.

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
