# How WorldArchitect Works

WorldArchitect is built around one core idea: a fictional world should become a durable, browsable body of knowledge, not a pile of disconnected notes.

The app gives each world its own local encyclopedia. You create articles, group them by category, connect them through parent-child relationships and references, and track chronology when events have a place in time.

## The Main Surfaces

- **World list** - create and reopen local worlds.
- **World creation wizard** - define a world premise, categories, and writing style.
- **World overview** - see article counts, World Bible status, and world-level tools.
- **Article page** - read, edit, expand, organize, and review an article.
- **Timeline** - browse temporally anchored articles in chronological order.
- **Snapshots** - create and restore named checkpoints of an entire world.
- **Usage and settings** - manage provider settings, call logs, and cost controls.

## Article Model

Each article is more than a text file. It can carry:

- A title and category
- A publication status
- A short introduction used by the World Bible
- A longer description
- Optional chronology
- Parent-child structure
- Cross-article references
- Version history
- Issues or warnings found by review tools

This structure lets the app behave like a lightweight world wiki while still supporting normal prose writing.

## The World Bible

The World Bible is a compact summary layer for the whole world. Each article contributes a short summary, and agents use those summaries as continuity context.

This avoids sending every full article to an LLM while still giving AI tools a broad view of the world. It also makes the app useful without AI, because the Bible is visible, editable, and exportable as part of the world.

## Creation And Review Flow

A typical workflow looks like this:

1. Create a world and initial categories.
2. Add article stubs manually or with the world creation tools.
3. Write articles yourself, or use Spark to generate proposals and drafts.
4. Review, edit, and accept only the content you want to keep.
5. Use Solidify, Issues, and Publish tools to clean up contradictions or rough prose.
6. Take snapshots before major changes.
7. Export the world as Markdown when you want a portable copy.

## Local App Shape

WorldArchitect runs as a local web app:

- The browser displays the interface.
- The local server owns the SQLite database, export, provider settings, and AI calls.
- The app can run with no provider configured.

That shape keeps the experience simple while still giving the project real persistence, versioning, and transaction-safe local storage.
