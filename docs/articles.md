# Article Lifecycle And Versioning

WorldArchitect articles are designed to feel like wiki pages, but behind the scenes each one is a small lifecycle: an article, one or more saved versions, optional pending drafts awaiting review, and links to other articles.

This document describes that lifecycle in plain terms.

## Core Concepts

An **article** is the stable identity of a world entry: its title, type, status, and place in the hierarchy.

An **article version** is a saved snapshot of an article's content (introduction and description). Editing an article creates a new version rather than overwriting the old one, so nothing is lost.

The **current version** is the working version — what you see and edit day to day.

The **published version** is a separate, independent pointer set only when you explicitly publish an article. Editing a published article creates a new current version without touching what's published, so the published content stays stable until you choose to publish again. The article page shows a clear indicator when there are unpublished edits.

A **draft bundle** is a reviewable unit of proposed content for one article — either AI-generated (from Forge or Consolidate) or your own manual edit staged for review. Nothing becomes part of the article until a draft is accepted.

The **World Bible** is a live summary view built from every article's current (or published) introduction — not something you maintain separately. It always reflects whatever your articles currently say.

A **concept candidate** is a named person, place, or thing that Consolidate noticed in your accepted prose and thinks might deserve its own article. These are suggestions only — accepting one creates or links a new stub article; ignoring one does nothing.

An **article type** is a predefined hint such as General, Person / Character, Location, Organization / Faction, or Event, used to guide the small infobox-style Details fields on the article page.

## Current Lifecycle

```text
stub article
  -> manual edit or AI draft, staged for review
  -> accepted, creating a new version
  -> reviewed article
  -> published through the Publish workflow
```

Articles move through `stub`, `draft`, `reviewed`, and `published` statuses. Once an article is published, editing it further does not change its published status or content — it just creates a new current version, and the article page will show that current and published now differ until you re-publish.

Forge's "Context basis" setting controls whether an AI run reads an article's current (in-progress) content or only its officially published content — useful when you want AI generation to build only on reviewed, published material rather than works in progress.

## Draft And Concept Review

Accepting a draft bundle validates the proposed content, creates a new version (or a new child article, for branching), and refreshes the World Bible automatically. The accepted draft moves into draft history; other pending drafts for the same article are unaffected.

Concept candidates are reviewed separately from drafts: accepting one reuses an existing article of the same title if one exists, or creates a new stub article and links it from the source article.

## Versioning

Versions are append-only — editing never destroys a prior version. Reverting to an older version is non-destructive too: it creates a new version copied from the old one rather than deleting anything in between, so version history stays a complete, linear record you can always step back through.

## Canon And Coherence

WorldArchitect does not track exact "this article was checked against that specific version of another article" dependencies. That means if one article changes, related articles aren't automatically flagged as needing a re-check purely because of that link. Coherence is instead handled by automatic checks, issue tracking, and agent review passes — see [Multi-Agent System Overview](mas-overview.md).

## Retention

The app keeps full article version history. Database backup is the right way to durably retain a world in both local and hosted setups — see [Local-First Data And Privacy](local-first.md).
