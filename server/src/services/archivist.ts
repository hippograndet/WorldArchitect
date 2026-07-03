import { getDbClient } from '../db/client.js';

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
  targetDescription: string;
  targetChronology: string;
  targetIntroduction: string;
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
export async function buildContextPackage(
  worldId: string,
  articleId: string,
  options: ArchivistOptions = {},
): Promise<ContextPackage> {
  const exec = getDbClient();
  const { mode = 'default', contextDepth = 'mid' } = options;

  const budgetByDepth: Record<ContextDepth, number> = {
    shallow: 1500,
    mid:     6000,
    deep:    12000,
  };
  const maxTokens = options.maxTokens ?? budgetByDepth[contextDepth];

  // Fetch target
  const target = await exec.get<Record<string, unknown>>(
    `SELECT a.id, a.title, a.template_type, a.temporal_anchor_start,
            av.introduction, av.description, av.chronology
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id
     WHERE a.id = ? AND a.world_id = ?`,
    [articleId, worldId],
  );

  if (!target) throw new Error(`Article ${articleId} not found in world ${worldId}`);

  const targetDescription = (target.description as string) ?? '';
  const targetChronology  = (target.chronology as string) ?? '';
  const targetIntroduction = (target.introduction as string) ?? '';
  const targetTitle = target.title as string;
  const targetTemplateType = target.template_type as string;
  const targetAnchor = (target.temporal_anchor_start as string | null) ?? null;

  let budget = maxTokens;

  // reorganize: full description+chronology count against budget as read-only constraint
  if (mode === 'reorganize') budget -= est(targetDescription) + est(targetChronology);

  const parents: ContextArticle[] = [];
  const siblings: ContextArticle[] = [];
  const children: ContextArticle[] = [];
  const fixedPoints: ContextArticle[] = [];
  const temporalNeighbors: Array<ContextArticle & { temporalAnchorStart: string }> = [];
  const referencedArticles: Array<{ id: string; title: string }> = [];

  const fetchDescription = async (articleRowId: string): Promise<string> => {
    const ver = await exec.get<{ description: string }>(
      `SELECT av.description FROM articles a LEFT JOIN article_versions av ON av.id = a.current_version_id WHERE a.id = ?`,
      [articleRowId],
    );
    return ver?.description ?? '';
  };

  // Status ordering: published > reviewed > draft > stub (anything else last)
  const STATUS_ORDER = `CASE a.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END`;

  const fillParents = async (): Promise<void> => {
    if (contextDepth === 'shallow') {
      // Shallow: only direct parents, intro only
      const rows = await exec.all<Record<string, unknown>>(
        `SELECT a.id, a.title, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.source_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
         WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
         ORDER BY ${STATUS_ORDER}, a.title
         LIMIT 2`,
        [articleId],
      );

      for (const r of rows) {
        const summary = (r.summary as string) ?? '';
        const cost = est(`### ${r.title}\n${summary}\n`);
        if (budget - cost < 0) break;
        parents.push({ id: r.id as string, title: r.title as string, summary });
        budget -= cost;
      }
      return;
    }

    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, wbe.summary
       FROM article_links al
       JOIN articles a ON a.id = al.source_article_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 4`,
      [articleId],
    );

    for (const r of rows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = await fetchDescription(r.id as string);
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

  const fillTemporalNeighbors = async (): Promise<void> => {
    if (contextDepth === 'shallow') return;
    const anchor = targetAnchor ?? '0000';

    const before = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.temporal_anchor_start, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
         AND a.temporal_anchor_start < ? AND a.id != ?
       ORDER BY a.temporal_anchor_start DESC, ${STATUS_ORDER} LIMIT 3`,
      [worldId, anchor, articleId],
    );

    const after = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.temporal_anchor_start, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
         AND a.temporal_anchor_start > ? AND a.id != ?
       ORDER BY a.temporal_anchor_start ASC, ${STATUS_ORDER} LIMIT 3`,
      [worldId, anchor, articleId],
    );

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

  const fillChildren = async (): Promise<void> => {
    if (contextDepth === 'shallow') return;

    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, wbe.summary
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE al.source_article_id = ? AND al.link_type = 'hierarchical'
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 12`,
      [articleId],
    );

    for (const r of rows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = await fetchDescription(r.id as string);
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
    await fillTemporalNeighbors();
    await fillChildren();
    await fillParents();
  } else {
    await fillParents();
    if (targetAnchor) await fillTemporalNeighbors();
  }

  // Siblings — other children of the same parents (skip in shallow mode)
  if (parents.length > 0 && contextDepth !== 'shallow') {
    const placeholders = parents.map(() => '?').join(', ');
    const siblingRows = await exec.all<Record<string, unknown>>(
      `SELECT DISTINCT a.id, a.title, wbe.summary
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE al.source_article_id IN (${placeholders})
         AND al.link_type = 'hierarchical' AND a.id != ?
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 6`,
      [...parents.map((p) => p.id), articleId],
    );

    for (const r of siblingRows) {
      const summary = (r.summary as string) ?? '';
      let description: string | undefined;

      if (contextDepth === 'deep') {
        const desc = await fetchDescription(r.id as string);
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
    await fillChildren();
  }

  // Fixed points — skip in shallow mode (L2+)
  if (contextDepth !== 'shallow') {
    const fixedRows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE a.world_id = ? AND a.is_fixed_point = 1 AND a.id != ?
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 10`,
      [worldId, articleId],
    );

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
    const refRows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       WHERE al.source_article_id = ? AND al.link_type = 'references'
       LIMIT 10`,
      [articleId],
    );

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
    targetDescription,
    targetChronology,
    targetIntroduction,
    parents,
    siblings,
    children,
    fixedPoints,
    temporalNeighbors,
    referencedArticles,
    estimatedTokens: maxTokens - budget,
  };
}
