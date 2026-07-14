# Article Lifecycle And Versioning

WorldArchitect articles are designed to feel like wiki pages, but the server stores them as a small lifecycle: an article record, one or more immutable versions, optional pending drafts, and graph/context data around the article.

This document describes the current article lifecycle and versioning behavior.

## Core Objects

An **article** is the stable identity of a world entry. It owns the title, internal seed group, article type, status, hierarchy depth, `current_version_id`, and `published_version_id`.

An **article version** is a saved content revision for one article. Versions store introduction, description, word count, created time, and optional metadata such as whether the version was created by a revert. Introduction and description live together on the same version row — there is no separate table holding a copy of either field.

A **current version** is the version pointed to by `articles.current_version_id`. This is the working state: normal reads, the article page, and agent context default to it.

A **published version** is the version pointed to by `articles.published_version_id`, set only by the Publish workflow (`POST /api/worlds/:wid/publish/commit`). It is a second, independent pointer — editing an article after publishing creates a new current version without moving the published one, so the published content stays the stable "official" version until the user explicitly publishes again. An article with unpublished edits has `current_version_id !== published_version_id`; the article page shows this as an "unpublished edits" indicator. Some MAS reads (Grow's "Context basis" setting; see below) can be pointed at the published version instead of current — an article that has never been published is treated as empty under that basis, not silently read from its current draft.

A **draft bundle** is a review unit for one article, either agent-generated (Expand/Consolidate/Inception) or a manual edit (`pipelineType: 'manual_edit'`, from the Introduction/Description pencil icon on the article page). Multiple pending bundles can exist — e.g. an Expand rerun alongside a manual edit — but only one pending `manual_edit` bundle is kept per article; re-saving a manual edit before accepting updates that same bundle in place rather than creating another. Accepted and discarded bundles remain in draft history, but only pending bundles can be accepted.

The **World Bible** is a rendered view over every article's current (or published, depending on context basis) version — not a separately stored or synced table. It always reflects whatever the relevant version's introduction currently is.

An **entity mention** is a Consolidate concept candidate found in accepted article prose. Pending mentions do not change the article graph. When the user accepts one, the app creates or reuses a same-depth article stub and adds a reference edge from the source article.

An **article type** is a predefined concept hint such as General, Person / Character, Location, Organization / Faction, or Event. It guides the small infobox-style Details fields on the article page.

## Current Lifecycle

```text
stub article
  -> manual edit or AI draft, staged as a pending draft bundle
  -> accepted, creating a draft article with current version
  -> reviewed article
  -> published article/version through publish workflow
```

The current app supports `stub`, `draft`, `reviewed`, and `published` article statuses. Publishing is tracked through `articles.published_version_id`: once set, it stays put through further edits (`status` stays `'published'` too — editing a published article does not revert its status), and only moves when the article is published again.

Editing a published article is not blocked. It creates a new current version the same way any other edit does; the published version remains what Publish-based reads see until the user re-publishes. The client shows a one-time confirmation the first time an edit diverges an article from its published version, just to make the "this proposes a new version, it doesn't touch the published one" behavior visible in the moment.

Agents reason from the current working version by default. A run's **context basis** (`current` / `latest_draft` / `published`) controls this per run — Grow's "Context basis" setting lets a run read every article it touches (the one being edited and everything pulled in as context) from its published version instead, treating never-published articles as empty rather than falling back to their drafts.

## Draft Acceptance

Accepting a draft bundle is a controlled write:

- The generated draft payload is validated.
- A new article version is created for normal article expansion.
- For `create_child`, a child article and child version are created.
- Optional parent append text creates a new parent version.
- Suggested links and warnings are written; the World Bible reflects the new content automatically since it reads off the version just committed. Inferred concept mentions are handled later through Consolidate scans.
- The accepted bundle is marked as history after a successful accept; other pending bundles for the article are left alone.
- Sync rules run after the commit.

The public accept endpoint remains:

```text
POST /api/worlds/:wid/articles/:aid/accept
```

New draft-id routes are used by the app for deterministic review:

```text
GET  /api/worlds/:wid/articles/:aid/drafts?status=pending|accepted|discarded|all
POST /api/worlds/:wid/articles/:aid/drafts/:draftId/accept
POST /api/worlds/:wid/articles/:aid/drafts/:draftId/discard
```

Normal accept returns:

```json
{ "article": "...", "version": "..." }
```

Child creation accept returns:

```json
{ "article": "...", "childArticle": "...", "childVersion": "..." }
```

## Concept Candidate Acceptance

Concept candidates are handled outside draft acceptance. Consolidate can scan accepted descriptions and store pending entity mentions. Accepting a mention:

- Reuses an exact-title article when one already exists.
- Otherwise creates a `stub` article at the source article's depth.
- Uses the mention summary as the new article introduction.
- Adds a `references` edge from the source article to the concept article.
- Marks the mention as `created`; ignored candidates are marked `ignored`.

## Versioning Rules

Article versions are append-only for normal editing. Reverting is non-destructive: the server creates a new version copied from the selected older version, marks it as a revert, and points the article at the new version.

This means version history is useful for undo/review. It is separate from canon dependency tracking.

Current version creation paths include:

- draft acceptance — the article page's Introduction/Description pencil icon now saves a `manual_edit` draft bundle rather than writing a version directly; accepting it (or any other draft) is what creates the version. The generic `PATCH /api/worlds/:wid/articles/:aid` direct-edit endpoint (`updateArticle`) still exists server-side and still creates a version immediately, but the article page UI no longer calls it.
- child article creation
- parent append during child creation
- issue fixer apply
- revert
- world creation root article

Draft acceptance, revert, and child/parent-append creation share a `commitArticleContent` helper (`server/src/services/articlesService.ts`) that writes the version and moves `articles.current_version_id` — there is nothing else to keep in sync, since the World Bible reads straight off that same version. A `manual_edit` draft's `draftContent` always carries both `introduction` and `description`, even when only one was actually changed: draft acceptance falls back to `''` for any field missing from `draftContent`, so an edit that omitted the untouched field would silently blank it on accept. The client (`saveManualEdit` in `client/src/stores/articleSlice.ts`) fills the other field from the article's current committed content before saving.

## Canon And Coherence Boundaries

The app does not store exact dependency edges such as:

```text
Article A version 4 was checked against Article B version 7
```

Because of that, if Article B changes later, Article A is not automatically known to be stale because of that exact version dependency. Coherence checks are handled by sync rules, issue records, manual review, and agent workflows rather than by a full canon dependency graph.

This is distinct from hierarchy/reference edges (`article_links`, shown in Graph view): those are not versioned either — an edge always resolves to whichever version of each article is current now — but each edge does record which version of its source and target were current at the moment the edge was set (`source_version_id`/`target_version_id`), as provenance metadata only. Neither mechanism notifies a linked article when the other side changes.

## Retention Guidance

The app keeps article versions. Database backup is the correct answer for durable retention in both local and hosted setups.
