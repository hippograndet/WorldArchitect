# Roadmap

WorldArchitect already has the core foundation for a local-first world encyclopedia:

- SQLite-backed worlds, articles, snapshots, and export
- Article versioning and non-destructive reverts
- World Bible summaries
- Timeline support
- Optional multi-agent creation and review tools
- Name Bank, article issues, publish flow, and cost controls

The next improvements are focused on reliability, scale, and larger creative workflows.

## Near-Term Polish

- Add public screenshots and a short demo flow to the README.
- Improve onboarding for first-time users.
- Make long AI calls feel more responsive.
- Move Forge automation to a safer server-side job model.
- Unify issue and warning presentation across review tools.

## Worldbuilding Depth

Future work is planned around three creative layers:

- **World layer** - the current encyclopedia of places, factions, events, cultures, technologies, and people.
- **Epistemic layer** - what different characters or factions know, believe, misunderstand, or hide.
- **Narrative layer** - scenes, story progression, character decisions, and consequences.

The goal is to let users move from encyclopedia-building into story development without losing the structured world foundation.

## Map System

A future map feature could support:

- Authoritative world maps
- Faction or character knowledge overlays
- Timeline-aware changes such as borders, journeys, and event locations

The map should work as a useful worldbuilding tool first, then expand into perspective and narrative layers.

## AI System Improvements

Planned MAS improvements include:

- Streaming responses for long-running drafts
- Better prompt/context caching where providers support it
- Safer Forge runs with resumable server-side jobs
- Better scaling for very large World Bibles
- More granular tools for names, cultures, cities, religions, factions, and historical events

## Guiding Principle

WorldArchitect should remain useful without AI. AI tools should deepen and accelerate the writing process, not become the only way to use the app.
