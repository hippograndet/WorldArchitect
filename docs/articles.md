# Article Lifecycle And Versioning

WorldArchitect articles are designed to feel like wiki pages, but the server stores them as a small lifecycle: an article record, one or more immutable versions, optional pending drafts, and graph/context data around the article.

This document describes the current article lifecycle and versioning behavior.

## Core Objects

An **article** is the stable identity of a world entry. It owns the title, category, template type, status, hierarchy depth, temporal anchors, fixed-point flag, and `current_version_id`.

An **article version** is a saved content revision for one article. Versions store introduction, description, chronology, word count, created time, and optional metadata such as whether the version was created by a revert.

A **current version** is the version pointed to by `articles.current_version_id`. Normal reads and agent context use the current version today.

A **pending draft** is a temporary generated draft waiting for user review. Pending drafts are not canonical article content. Accepting a draft creates article versions and then deletes the pending draft.

A **World Bible entry** is a concise summary used for context and continuity. It is updated when article introductions or summaries change.

An **entity mention** is a Consolidate concept candidate found in accepted article prose. Pending mentions do not change the article graph. When the user accepts one, the app creates or reuses a same-depth article stub and adds a reference edge from the source article.

## Current Lifecycle

```text
stub article
  -> manual edit or accepted AI draft
  -> draft article with current version
  -> reviewed article
  -> published article/version through publish workflow
```

The current app supports `stub`, `draft`, and `reviewed` article statuses directly in article editing. Publishing is tracked through publish/snapshot flows and `article_versions.is_published`.

Today, the app mostly treats `current_version_id` as the active working state. Published state exists, but agents generally reason from the current working version unless a route explicitly fetches publish/snapshot data.

## Draft Acceptance

Accepting a pending draft is a controlled write:

- The generated draft payload is validated.
- A new article version is created for normal article expansion.
- For `create_child`, a child article and child version are created.
- Optional parent append text creates a new parent version.
- Suggested links, warnings, and World Bible updates are written. Inferred concept mentions are handled later through Consolidate scans.
- The pending draft is deleted after a successful accept.
- Sync rules run after the commit.

The public accept endpoint remains:

```text
POST /api/worlds/:wid/articles/:aid/accept
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

- manual article creation
- manual article edit
- draft acceptance
- child article creation
- parent append during child creation
- issue fixer apply
- revert
- world creation root article
- architect-generated stubs

These paths share a server-side version writer.

## Canon And Coherence Boundaries

The app does not store exact dependency edges such as:

```text
Article A version 4 was checked against Article B version 7
```

Because of that, if Article B changes later, Article A is not automatically known to be stale because of that exact version dependency. Coherence checks are handled by sync rules, issue records, manual review, and agent workflows rather than by a full canon dependency graph.

## Retention Guidance

The app keeps article versions. Database backup is the correct answer for durable retention in both local and hosted setups.
