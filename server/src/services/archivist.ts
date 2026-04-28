import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextArticle {
  id: string;
  title: string;
  summary: string;
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

export interface ArchivistOptions {
  mode?: ArchivistMode;
  maxTokens?: number;
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
  const { mode = 'default', maxTokens = 6000 } = options;

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

  const fillParents = (): void => {
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
      const cost = est(`### ${r.title}\n${summary}\n`);
      if (budget - cost < 0) break;
      parents.push({ id: r.id as string, title: r.title as string, summary });
      budget -= cost;
    }
  };

  const fillTemporalNeighbors = (): void => {
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
      const cost = est(`- ${r.title}: ${summary}\n`);
      if (budget - cost < 0) break;
      children.push({ id: r.id as string, title: r.title as string, summary });
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

  // Siblings — other children of the same parents
  if (parents.length > 0) {
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
      const cost = est(`- ${r.title}: ${summary}\n`);
      if (budget - cost < 0) break;
      siblings.push({ id: r.id as string, title: r.title as string, summary });
      budget -= cost;
    }
  }

  // Children tier for propose_children (also added for expand_chronology above)
  if (mode === 'propose_children') {
    fillChildren();
  }

  // Fixed points (up to 10)
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

  // Referenced articles — titles only
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
