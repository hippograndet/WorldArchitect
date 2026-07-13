# Article Lifecycle And Versioning

WorldArchitect articles are designed to feel like wiki pages, but the server stores them as a small lifecycle: an article record, one or more immutable versions, optional pending drafts, and graph/context data around the article.

This document describes the current article lifecycle and versioning behavior.

## Core Objects

An **article** is the stable identity of a world entry. It owns the title, internal seed group, article type, status, hierarchy depth, and `current_version_id`.

An **article version** is a saved content revision for one article. Versions store introduction, description, word count, created time, and optional metadata such as whether the version was created by a revert.

A **current version** is the version pointed to by `articles.current_version_id`. Normal reads and agent context use the current version today.

A **draft bundle** is a review unit for one article, either agent-generated (Expand/Consolidate/Inception) or a manual edit (`pipelineType: 'manual_edit'`, from the Introduction/Description pencil icon on the article page). Multiple pending bundles can exist — e.g. an Expand rerun alongside a manual edit — but only one pending `manual_edit` bundle is kept per article; re-saving a manual edit before accepting updates that same bundle in place rather than creating another. Accepted and discarded bundles remain in draft history, but only pending bundles can be accepted.

A **World Bible entry** is a concise summary used for context and continuity. It is updated when article introductions or summaries change.

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

The current app supports `stub`, `draft`, and `reviewed` article statuses directly in article editing. Publishing is tracked through publish/snapshot flows and `article_versions.is_published`.

Today, the app mostly treats `current_version_id` as the active working state. Published state exists, but agents generally reason from the current working version unless a route explicitly fetches publish/snapshot data.

## Draft Acceptance

Accepting a draft bundle is a controlled write:

- The generated draft payload is validated.
- A new article version is created for normal article expansion.
- For `create_child`, a child article and child version are created.
- Optional parent append text creates a new parent version.
- Suggested links, warnings, and World Bible updates are written. Inferred concept mentions are handled later through Consolidate scans.
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
- architect-generated stubs

Draft acceptance, revert, and child/parent-append creation share a `commitArticleContent` helper (`server/src/services/articlesService.ts`) that writes the version, moves `articles.current_version_id`, and syncs the matching World Bible entry together — see the World Bible paragraph above. A `manual_edit` draft's `draftContent` always carries both `introduction` and `description`, even when only one was actually changed: draft acceptance falls back to `''` for any field missing from `draftContent`, so an edit that omitted the untouched field would silently blank it on accept. The client (`saveManualEdit` in `client/src/stores/articleSlice.ts`) fills the other field from the article's current committed content before saving.

## Canon And Coherence Boundaries

The app does not store exact dependency edges such as:

```text
Article A version 4 was checked against Article B version 7
```

Because of that, if Article B changes later, Article A is not automatically known to be stale because of that exact version dependency. Coherence checks are handled by sync rules, issue records, manual review, and agent workflows rather than by a full canon dependency graph.

## Retention Guidance

The app keeps article versions. Database backup is the correct answer for durable retention in both local and hosted setups.
