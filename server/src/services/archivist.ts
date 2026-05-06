import { getDb } from '../db/index.js';
import { splitSections } from './sections.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextArticle {
  id: string;
  title: string;
  summary: string;
  description?: string; // populated in deep mode for L1 relations
}

export interface ContextPackage {
  targetId: string;
  targetTitle: string;
  targetTemplateType: string;
  targetBody: string;
  targetSummary: string;
  parents: ContextArticle[];
  siblings: ContextArticle[];
  children: ContextArticle[];
  fixedPoints: ContextArticle[];
  temporalNeighbors: Array<ContextArticle & { temporalAnchorStart: string }>;
  referencedArticles: Array<{ id: string; title: string }>;
  estimatedTokens: number;
}

export type ArchivistMode =
  | 'default'
  | 'expand_chronology'   // timeline + children tiers first
  | 'propose_children'    // children tier added (see what already exists)
  | 'reorganize';         // full body counts against budget

export type ContextDepth = 'shallow' | 'mid' | 'deep';

export interface ArchivistOptions {
  mode?: ArchivistMode;
  maxTokens?: number;
  contextDepth?: ContextDepth;
}

// ---------------------------------------------------------------------------
// Token estimation (char-based, no API call)
// ---------------------------------------------------------------------------

function est(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

/**
 * Build a tiered context package for a given article.
 *
 * Default tier ordering:
 *   1. Parents (hierarchical links pointing to this article)
 *   2. Temporal neighbours (articles nearest in time, only when target has anchor)
 *   3. Siblings (other children of the same parents)
 *   4. Fixed points
 *   5. Referenced articles (titles only)
 *
 * Mode overrides:
 *   expand_chronology — temporal + children first, then parents
 *   propose_children  — children tier added after siblings
 *   reorganize        — full body counts against budget first
 */
export function buildContextPackage(
  worldId: string,
  articleId: string,
  options: ArchivistOptions = {},
): ContextPackage {
  const db = getDb();
  const { mode = 'default', contextDepth = 'mid' } = options;

  const budgetByDepth: Record<ContextDepth, number> = {
    shallow: 1500,
    mid:     6000,
    deep:    12000,
  };
  const maxTokens = options.maxTokens ?? budgetByDepth[contextDepth];

  // Fetch target
  const target = db
    .prepare(
      `SELECT a.id, a.title, a.template_type, a.temporal_anchor_start,
              av.body, av.summary
       FROM articles a
       LEFT JOIN article_versions av ON av.id = a.current_version_id
       WHERE a.id = ? AND a.world_id = ?`,
    )
    .get(articleId, worldId) as Record<string, unknown> | undefined;

  if (!target) throw new Error(`Article ${articleId} not found in world ${worldId}`);

  const targetBody = (target.body as string) ?? '';
  const targetSummary = (target.summary as string) ?? '';
  const targetTitle = target.title as string;
  const targetTemplateType = target.template_type as string;
  const targetAnchor = (target.temporal_anchor_start as string | null) ?? null;

  let budget = maxTokens;

  // reorganize: full body is a read-only constraint and counts against budget
  if (mode === 'reorganize') budget -= est(targetBody);

  const parents: ContextArticle[] = [];
  const siblings: ContextArticle[] = [];
  const children: ContextArticle[] = [];
  const fixedPoints: ContextArticle[] = [];
  const temporalNeighbors: Array<ContextArticle & { temporalAnchorStart: string }> = [];
  const referencedArticles: Array<{ id: string; title: string }> = [];

  const fetchDescription = (articleRowId: string): string => {
    const ver = db
      .prepare(`SELECT av.body FROM articles a LEFT JOIN article_versions av ON av.id = a.current_version_id WHERE a.id = ?`)
      .get(articleRowId) as { body: string } | undefined;
    return ver ? splitSections(ver.body ?? '').description : '';
  };

  const fillParents = (): void => {
    if (contextDepth === 'shallow') {
      // Shallow: only direct parents, intro only
      const rows = db
        .prepare(
          `SELECT a.id, a.title, wbe.summary
           FROM article_links al
           JOIN articles a ON a.id = al.source_article_id
           LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
           WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
           LIMIT 2`,
        )
        .all(articleId) as Record<string, unknown>[];

      for (const r of rows) {
        const summary = (r.summary as string) ?? '';
        const cost = est(`### ${r.title}\n${summary}\n`);
        if (budget - cost < 0) break;
        parents.push({ id: r.id as string, title: r.title as string, summary });
        budget -= cost;
      }
      return;
    }

    const rows = db
      .prepare(
        `SELECT a.id, a.title, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.source_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
         LIMIT 4`,
      )
      .all(articleId) as Record<string, unknown>[];

    for (const r of rows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = fetchDescription(r.id as string);
        const descCost = est(desc);
        if (desc && budget - est(`### ${r.title}\n${summary}\n`) - descCost >= 0) {
          description = desc;
        }
      }

      const cost = est(`### ${r.title}\n${summary}\n`) + (description ? est(description) : 0);
      if (budget - cost < 0) break;
      parents.push({ id: r.id as string, title: r.title as string, summary, description });
      budget -= cost;
    }
  };

  const fillTemporalNeighbors = (): void => {
    if (contextDepth === 'shallow') return;
    const anchor = targetAnchor ?? '0000';

    const before = db
      .prepare(
        `SELECT a.id, a.title, a.temporal_anchor_start, wbe.summary
         FROM articles a
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
           AND a.temporal_anchor_start < ? AND a.id != ?
         ORDER BY a.temporal_anchor_start DESC LIMIT 3`,
      )
      .all(worldId, anchor, articleId) as Record<string, unknown>[];

    const after = db
      .prepare(
        `SELECT a.id, a.title, a.temporal_anchor_start, wbe.summary
         FROM articles a
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
           AND a.temporal_anchor_start > ? AND a.id != ?
         ORDER BY a.temporal_anchor_start ASC LIMIT 3`,
      )
      .all(worldId, anchor, articleId) as Record<string, unknown>[];

    for (const r of [...before.reverse(), ...after]) {
      const summary = (r.summary as string) ?? '';
      const cost = est(`### ${r.title}\n${summary}\n`);
      if (budget - cost < 0) break;
      temporalNeighbors.push({
        id: r.id as string,
        title: r.title as string,
        summary,
        temporalAnchorStart: r.temporal_anchor_start as string,
      });
      budget -= cost;
    }
  };

  const fillChildren = (): void => {
    if (contextDepth === 'shallow') return;

    const rows = db
      .prepare(
        `SELECT a.id, a.title, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.target_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE al.source_article_id = ? AND al.link_type = 'hierarchical'
         LIMIT 12`,
      )
      .all(articleId) as Record<string, unknown>[];

    for (const r of rows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = fetchDescription(r.id as string);
        const descCost = est(desc);
        if (desc && budget - est(`- ${r.title}: ${summary}\n`) - descCost >= 0) {
          description = desc;
        }
      }

      const cost = est(`- ${r.title}: ${summary}\n`) + (description ? est(description) : 0);
      if (budget - cost < 0) break;
      children.push({ id: r.id as string, title: r.title as string, summary, description });
      budget -= cost;
    }
  };

  // Tier ordering by mode
  if (mode === 'expand_chronology') {
    fillTemporalNeighbors();
    fillChildren();
    fillParents();
  } else {
    fillParents();
    if (targetAnchor) fillTemporalNeighbors();
  }

  // Siblings — other children of the same parents (skip in shallow mode)
  if (parents.length > 0 && contextDepth !== 'shallow') {
    const placeholders = parents.map(() => '?').join(', ');
    const siblingRows = db
      .prepare(
        `SELECT DISTINCT a.id, a.title, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.target_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE al.source_article_id IN (${placeholders})
           AND al.link_type = 'hierarchical' AND a.id != ?
         LIMIT 6`,
      )
      .all(...parents.map((p) => p.id), articleId) as Record<string, unknown>[];

    for (const r of siblingRows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = fetchDescription(r.id as string);
        const descCost = est(desc);
        if (desc && budget - est(`- ${r.title}: ${summary}\n`) - descCost >= 0) {
          description = desc;
        }
      }

      const cost = est(`- ${r.title}: ${summary}\n`) + (description ? est(description) : 0);
      if (budget - cost < 0) break;
      siblings.push({ id: r.id as string, title: r.title as string, summary, description });
      budget -= cost;
    }
  }

  // Children tier for propose_children (also added for expand_chronology above)
  if (mode === 'propose_children') {
    fillChildren();
  }

  // Fixed points — skip in shallow mode (L2+)
  if (contextDepth !== 'shallow') {
    const fixedRows = db
      .prepare(
        `SELECT a.id, a.title, wbe.summary
         FROM articles a
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE a.world_id = ? AND a.is_fixed_point = 1 AND a.id != ?
         LIMIT 10`,
      )
      .all(worldId, articleId) as Record<string, unknown>[];

    for (const r of fixedRows) {
      const summary = (r.summary as string) ?? '';
      const cost = est(`### ${r.title}\n${summary}\n`);
      if (budget - cost < 0) break;
      fixedPoints.push({ id: r.id as string, title: r.title as string, summary });
      budget -= cost;
    }
  }

  // Referenced articles — titles only, skip in shallow mode
  if (contextDepth !== 'shallow') {
    const refRows = db
      .prepare(
        `SELECT a.id, a.title
         FROM article_links al
         JOIN articles a ON a.id = al.target_article_id
         WHERE al.source_article_id = ? AND al.link_type = 'references'
         LIMIT 10`,
      )
      .all(articleId) as Record<string, unknown>[];

    for (const r of refRows) {
      const cost = est(`- ${r.title}\n`);
      if (budget - cost < 0) break;
      referencedArticles.push({ id: r.id as string, title: r.title as string });
      budget -= cost;
    }
  }

  return {
    targetId: articleId,
    targetTitle,
    targetTemplateType,
    targetBody,
    targetSummary,
    parents,
    siblings,
    children,
    fixedPoints,
    temporalNeighbors,
    referencedArticles,
    estimatedTokens: maxTokens - budget,
  };
}
