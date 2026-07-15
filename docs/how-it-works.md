# How WorldArchitect Works

WorldArchitect is built around one core idea: a fictional world should become a durable, browsable body of knowledge, not a pile of disconnected notes.

The app gives each world its own local encyclopedia. Worlds start with a root article, then grow through child subjects, Expand runs, and reviewed concept candidates connected by parent-child relationships and references.

![WorldArchitect worlds menu](assets/Screenshot_Worlds_Menu.png)

## The Main Surfaces

- **World list** - create and reopen local worlds.
- **World creation wizard** - define a world premise and writing style.
- **World overview** - see article counts, World Bible status, and world-level tools.
- **Article page** - read, edit, organize, and review a document.
- **Expand** - configure MAS generation runs that incept, expand, branch, and optionally recurse through part of the world.
- **Graph** - inspect the world as connected articles, with hierarchy rings and reference links.
- **Toolbox** - generate and manage reusable worldbuilding material such as names.
- **Consolidate** - review article/world issues, reorganize prose, check coherence, and scan accepted prose for concept candidates.
- **Snapshots** - create and restore named checkpoints of an entire world.
- **Usage and settings** - manage provider settings, call logs, and cost controls.

![World overview dashboard](assets/Screenshot_World_Home_Page.png)

## Article Model

Each article is more than a text file. It can carry:

- A title and predefined article type
- Infobox-style details
- A publication status
- A short introduction used by the World Bible
- A longer description
- Parent-child structure
- Cross-article references
- Version history
- Issues or warnings found by review tools

This structure lets the app behave like a lightweight world wiki while still supporting normal prose writing.

![Article reading and editing view](assets/Screenshot_Document_Text.png)

## Graph View

The graph view turns a world into a navigable map. The head article sits at the center, hierarchical children move outward by depth, and reference edges show cross-links that do not necessarily imply parentage.

You can select a node to see its exact article introduction, open the article, or add new hierarchy and reference edges. This makes the structure of a world easier to inspect as it grows beyond a simple tree.

![World graph view](assets/Screenshot_World_Graph.png)

## Toolbox

The Toolbox collects focused utilities that support worldbuilding without forcing them into the article editor. It is useful when you need reusable material, such as name generation and saved name banks, while keeping the encyclopedia itself organized.

![Toolbox utilities](assets/Screenshot_Toolbox.png)

## The World Bible

The World Bible is a compact summary layer for the whole world. Each article contributes a short summary, and agents use those summaries as continuity context.

This avoids sending every full article to an LLM while still giving AI tools a broad view of the world. It also makes the app useful without AI, because the Bible is visible, editable, and exportable as part of the world.

## Creation And Review Flow

A typical workflow looks like this:

1. Create a world and root article.
2. Add child subjects from an existing article, or use Expand to branch and recurse through selected parts of the world.
3. Write article prose yourself, or use Expand to incept and elaborate selected documents.
4. Choose the validation level for each run: Manual, Assisted, or Autopilot.
5. Review, edit, and accept generated introductions, proposals, ideas, drafts, or child plans when the selected validation level asks for user input.
6. Use Consolidate, Issues, and Publish tools to clean up contradictions or rough prose.
7. Take snapshots before major changes.
8. Export the world as Markdown when you want a portable copy.

## Expand Runs

Expand is the growth workflow for the encyclopedia. A run starts from a selected document and can begin at Inception, Expansion, or Branching.

- **Inception** creates or improves the document introduction used by the World Bible.
- **Expansion** writes fuller description prose from creative direction, world context, and optional guidance. Scribe drafts the prose directly; inferred concepts are left for Consolidate so accepting an expansion draft does not create surprise documents.
- **Branching** proposes or creates child documents below the selected node.

The user controls how far the MAS continues. A run can stop after one step, finish the selected document, or recurse into newly created children. Finishing the selected document means continuing through the remaining selected-document steps, including Branching after an accepted Expansion draft. Recursive runs can use breadth-first or depth-first queue order, child limits, creation-depth limits, and existing-content rules such as improve, replace, skip, or create only if empty.

Validation level controls how much autonomy the MAS has:

- **Manual** pauses at each meaningful review gate, including introduction review, proposal selection, idea selection, draft review, and child selection where those gates apply.
- **Assisted** can auto-select low-risk directions or ideas while still pausing before important article-changing outputs are committed.
- **Autopilot** can auto-select, continue, and commit during the run.

When a run needs the user, it enters a `needs_input` state and the selected run view shows an action panel inside Expand. The same panel renders different gate types, so the user can select, edit, accept, or reject the pending MAS output without leaving the run view.

## Consolidate And Concept Candidates

Consolidate is the maintenance workflow for material that already exists in the encyclopedia. It can reorganize rough prose, run coherence checks, surface issue queues, and scan accepted article descriptions for significant concepts that may deserve their own article.

Concept scanning is review-first. The Mention Extractor reads accepted prose and records pending concept candidates, but it does not create documents immediately. The user can then create or link a candidate from Consolidate, which creates a same-depth stub when needed and adds a reference edge from the source article. Ignored candidates are kept out of the active review queue.

## Local App Shape

WorldArchitect runs as a local web app:

- The browser displays the interface.
- The local server owns the Postgres database, export, provider settings, and AI calls.
- The app can run with no provider configured.

That shape keeps the experience simple while still giving the project real persistence, versioning, and transaction-safe local storage.

Hosted mode keeps the same server/database architecture but adds authenticated tenants. Clerk identifies the user, world routes verify ownership, and tenant-owned rows carry an `owner_id`. The server also sets a Postgres request tenant so Row-Level Security policies can enforce the same boundary inside the database, as a second layer on top of those application-level checks.

For the technologies involved, see [Tech Stack](tech-stack.md).
