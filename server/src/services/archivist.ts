import { getDbClient } from '../db/client.js';
import { ownerParams, ownerPredicate, worldOwnerParams, worldOwnerPredicate } from '../db/tenantScope.js';
import { findLatestPendingDraftRows, type DraftContextBasis } from './draftsService.js';
import type {
  ArticleContextMode,
  ArticleContextSource,
  ArticleDependencyReference,
  ArticleDependencyType,
  ArticleFactAuthority,
  ArticleMetadataFact,
  ArticleSubjectType,
} from '../types/articleSemantics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextArticle {
  id: string;
  title: string;
  summary: string;
  description?: string; // populated in deep mode for L1 relations
  source?: ArticleContextSource;
}

/**
 * The single seam all context reaches agents through. A future RAG tier is a new
 * optional array field here (e.g. `retrievedArticles?: ContextArticle[]`), not a
 * new agent-facing tool — retrieval stays internal to this context orchestrator.
 */
export interface ContextPackage {
  targetId: string;
  targetVersionId?: string | null;
  targetTitle: string;
  targetTemplateType: string;
  targetSubjectType?: ArticleSubjectType;
  targetDescription: string;
  targetChronology: string;
  targetIntroduction: string;
  contextMode?: ArticleContextMode;
  parents: ContextArticle[];
  siblings: ContextArticle[];
  children: ContextArticle[];
  fixedPoints: ContextArticle[];
  temporalNeighbors: Array<ContextArticle & { temporalAnchorStart: string }>;
  referencedArticles: Array<{ id: string; title: string }>;
  dependencies?: ArticleDependencyReference[];
  metadataFacts?: ArticleMetadataFact[];
  contextBasis?: DraftContextBasis;
  contextDraftIds?: string[];
  estimatedTokens: number;
}

export type ArchivistMode =
  | 'default'
  | 'propose_children'    // children tier added (see what already exists)
  | 'reorganize';         // full body counts against budget

export type ContextDepth = 'shallow' | 'mid' | 'deep';

export interface ArchivistOptions {
  ownerId: string;
  mode?: ArchivistMode;
  maxTokens?: number;
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
}

// ---------------------------------------------------------------------------
// Token estimation (char-based, no API call)
// ---------------------------------------------------------------------------

function est(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Status → semantic-authority mapping (source-aware, forward-compatible with
// version-aware canon: today authority/contextMode are derived from
// articles.status, since no separate canon/authority table exists yet)
// ---------------------------------------------------------------------------

function toContextMode(status: string | null | undefined): ArticleContextMode {
  if (status === 'published') return 'published';
  if (status === 'reviewed') return 'reviewed';
  return 'working_current';
}

function toAuthority(status: string | null | undefined): ArticleFactAuthority {
  if (status === 'published') return 'published';
  if (status === 'reviewed') return 'reviewed';
  return 'draft';
}

function buildContextSource(row: Record<string, unknown>): ArticleContextSource {
  const status = (row.status as string | null) ?? null;
  return {
    articleId: row.id as string,
    versionId: (row.current_version_id as string | null) ?? null,
    contextMode: toContextMode(status),
    authority: toAuthority(status),
  };
}

function parseDraftContent(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row?.draft_content) return null;
  try {
    const parsed: unknown = JSON.parse(row.draft_content as string);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function draftString(content: Record<string, unknown> | null, key: string): string | undefined {
  const value = content?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const KNOWN_SUBJECT_TYPES = new Set<string>([
  'general', 'character', 'location', 'faction', 'event', 'concept', 'object', 'organization',
]);

function toSubjectType(templateType: string): ArticleSubjectType {
  if (templateType === 'historical_event') return 'event';
  return (KNOWN_SUBJECT_TYPES.has(templateType) ? templateType : 'general') as ArticleSubjectType;
}

function toDependency(
  sourceRow: { id: string; versionId?: string | null },
  targetRow: { id: string; versionId?: string | null },
  dependencyType: ArticleDependencyType,
): ArticleDependencyReference {
  return {
    sourceArticleId: sourceRow.id,
    sourceVersionId: sourceRow.versionId ?? null,
    targetArticleId: targetRow.id,
    targetVersionId: targetRow.versionId ?? null,
    dependencyType,
  };
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
 *   propose_children  — children tier added after siblings
 *   reorganize        — full body counts against budget first
 */
export async function buildContextPackage(
  worldId: string,
  articleId: string,
  options: ArchivistOptions,
): Promise<ContextPackage> {
  const exec = getDbClient();
  const { mode = 'default', contextDepth = 'mid', contextBasis = 'current' } = options;

  const budgetByDepth: Record<ContextDepth, number> = {
    shallow: 1500,
    mid:     6000,
    deep:    12000,
  };
  const maxTokens = options.maxTokens ?? budgetByDepth[contextDepth];

  // Fetch target
  const target = await exec.get<Record<string, unknown>>(
    `SELECT a.id, a.title, a.template_type, a.temporal_anchor_start, a.status, a.current_version_id,
            av.introduction, av.description, av.chronology
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', options.ownerId)}
     WHERE a.id = ? AND ${worldOwnerPredicate('a', options.ownerId)}`,
    [...ownerParams(options.ownerId), articleId, ...worldOwnerParams(worldId, options.ownerId)],
  );

  if (!target) throw new Error(`Article ${articleId} not found in world ${worldId}`);

  let targetDescription = (target.description as string) ?? '';
  let targetChronology  = (target.chronology as string) ?? '';
  let targetIntroduction = (target.introduction as string) ?? '';
  const targetTitle = target.title as string;
  const targetTemplateType = target.template_type as string;
  const targetVersionId = (target.current_version_id as string | null) ?? null;
  const targetSubjectType = toSubjectType(targetTemplateType);
  const contextMode = toContextMode((target.status as string | null) ?? null);
  const targetAnchor = (target.temporal_anchor_start as string | null) ?? null;

  const dependencies: ArticleDependencyReference[] = [];

  let budget = maxTokens;
  const contextDraftIds = new Set<string>();
  const latestDraftCache = new Map<string, Record<string, unknown> | undefined>();
  const publishedVersionCache = new Map<string, { introduction: string; description: string; chronology: string } | undefined>();

  const publishedVersionFor = async (targetArticleId: string): Promise<{ introduction: string; description: string; chronology: string } | undefined> => {
    if (contextBasis !== 'published') return undefined;
    if (publishedVersionCache.has(targetArticleId)) return publishedVersionCache.get(targetArticleId);
    const row = await exec.get<{ introduction: string; description: string; chronology: string }>(
      `SELECT introduction, description, chronology
       FROM article_versions
       WHERE article_id = ?${ownerPredicate('article_versions', options.ownerId)} AND is_published = 1
       ORDER BY version_number DESC
       LIMIT 1`,
      [targetArticleId, ...ownerParams(options.ownerId)],
    );
    publishedVersionCache.set(targetArticleId, row);
    return row;
  };

  const latestDraftFor = async (targetArticleId: string): Promise<Record<string, unknown> | undefined> => {
    if (contextBasis !== 'latest_draft') return undefined;
    if (latestDraftCache.has(targetArticleId)) return latestDraftCache.get(targetArticleId);
    const rows = await findLatestPendingDraftRows({
      worldId,
      ownerId: options.ownerId,
      articleIds: [targetArticleId],
    });
    const row = rows.get(targetArticleId);
    latestDraftCache.set(targetArticleId, row);
    if (row?.id) contextDraftIds.add(row.id as string);
    return row;
  };

  const draftIntroductionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    const published = await publishedVersionFor(targetArticleId);
    if (published) return published.introduction ?? fallback;
    const draft = await latestDraftFor(targetArticleId);
    const content = parseDraftContent(draft);
    return draftString(content, 'introduction') ?? draftString(content, 'childDescription') ?? fallback;
  };

  const draftDescriptionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    const published = await publishedVersionFor(targetArticleId);
    if (published) return published.description ?? fallback;
    const draft = await latestDraftFor(targetArticleId);
    const content = parseDraftContent(draft);
    return draftString(content, 'description') ?? draftString(content, 'childDescription') ?? fallback;
  };

  if (contextBasis === 'published') {
    const published = await publishedVersionFor(articleId);
    if (published) targetChronology = published.chronology ?? targetChronology;
  }

  const contextSummaryFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    return draftIntroductionFor(targetArticleId, fallback);
  };

  const contextDescriptionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    return draftDescriptionFor(targetArticleId, fallback);
  };

  targetIntroduction = await draftIntroductionFor(articleId, targetIntroduction);
  targetDescription = await draftDescriptionFor(articleId, targetDescription);

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
      `SELECT av.description
       FROM articles a
       LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', options.ownerId)}
       WHERE a.id = ?${ownerPredicate('a', options.ownerId)}`,
      [...ownerParams(options.ownerId), articleRowId, ...ownerParams(options.ownerId)],
    );
    return contextDescriptionFor(articleRowId, ver?.description ?? '');
  };

  /**
   * In 'deep' mode, opportunistically attaches a linked article's full description
   * if it still fits the remaining budget alongside its summary; otherwise falls
   * back to summary-only. Shared by every tier that offers deep-mode descriptions
   * (parents/children/siblings) so the fetch-then-cost-check logic lives in one place.
   */
  const withDeepDescription = async (
    r: Record<string, unknown>,
    label: string,
    currentBudget: number,
  ): Promise<{ description?: string; cost: number }> => {
    let description: string | undefined;
    if (contextDepth === 'deep') {
      const desc = await fetchDescription(r.id as string);
      const descCost = est(desc);
      if (desc && currentBudget - est(label) - descCost >= 0) {
        description = desc;
      }
    }
    return { description, cost: est(label) + (description ? est(description) : 0) };
  };

  // Status ordering: published > reviewed > draft > stub (anything else last)
  const STATUS_ORDER = `CASE a.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END`;

  const fillParents = async (): Promise<void> => {
    if (contextDepth === 'shallow') {
      // Shallow: only direct parents, intro only
      const rows = await exec.all<Record<string, unknown>>(
        `SELECT a.id, a.title, a.status, a.current_version_id, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.source_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
         WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
           AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
         ORDER BY ${STATUS_ORDER}, a.title
         LIMIT 2`,
        [...ownerParams(options.ownerId), articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
      );

      for (const r of rows) {
        const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
        const cost = est(`### ${r.title}\n${summary}\n`);
        if (budget - cost < 0) break;
        parents.push({ id: r.id as string, title: r.title as string, summary, source: buildContextSource(r) });
        dependencies.push(toDependency(
          { id: r.id as string, versionId: r.current_version_id as string | null },
          { id: articleId, versionId: targetVersionId },
          'hierarchy',
        ));
        budget -= cost;
      }
      return;
    }

    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id, wbe.summary
       FROM article_links al
       JOIN articles a ON a.id = al.source_article_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
       WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
         AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 4`,
      [...ownerParams(options.ownerId), articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of rows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const { description, cost } = await withDeepDescription(r, `### ${r.title}\n${summary}\n`, budget);
      if (budget - cost < 0) break;
      parents.push({ id: r.id as string, title: r.title as string, summary, description, source: buildContextSource(r) });
      dependencies.push(toDependency(
        { id: r.id as string, versionId: r.current_version_id as string | null },
        { id: articleId, versionId: targetVersionId },
        'hierarchy',
      ));
      budget -= cost;
    }
  };

  const fillTemporalNeighbors = async (): Promise<void> => {
    if (contextDepth === 'shallow') return;
    const anchor = targetAnchor ?? '0000';

    const before = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.temporal_anchor_start, a.status, a.current_version_id, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
       WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
         ${ownerPredicate('a', options.ownerId)}
         AND a.temporal_anchor_start < ? AND a.id != ?
       ORDER BY a.temporal_anchor_start DESC, ${STATUS_ORDER} LIMIT 3`,
      [...ownerParams(options.ownerId), worldId, ...ownerParams(options.ownerId), anchor, articleId],
    );

    const after = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.temporal_anchor_start, a.status, a.current_version_id, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
       WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
         ${ownerPredicate('a', options.ownerId)}
         AND a.temporal_anchor_start > ? AND a.id != ?
       ORDER BY a.temporal_anchor_start ASC, ${STATUS_ORDER} LIMIT 3`,
      [...ownerParams(options.ownerId), worldId, ...ownerParams(options.ownerId), anchor, articleId],
    );

    for (const r of [...before.reverse(), ...after]) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const cost = est(`### ${r.title}\n${summary}\n`);
      if (budget - cost < 0) break;
      temporalNeighbors.push({
        id: r.id as string,
        title: r.title as string,
        summary,
        temporalAnchorStart: r.temporal_anchor_start as string,
        source: buildContextSource(r),
      });
      budget -= cost;
    }
  };

  const fillChildren = async (): Promise<void> => {
    if (contextDepth === 'shallow') return;

    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id, wbe.summary
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
       WHERE al.source_article_id = ? AND al.link_type = 'hierarchical'
         AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 12`,
      [...ownerParams(options.ownerId), articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of rows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const { description, cost } = await withDeepDescription(r, `- ${r.title}: ${summary}\n`, budget);
      if (budget - cost < 0) break;
      children.push({ id: r.id as string, title: r.title as string, summary, description, source: buildContextSource(r) });
      dependencies.push(toDependency(
        { id: articleId, versionId: targetVersionId },
        { id: r.id as string, versionId: r.current_version_id as string | null },
        'hierarchy',
      ));
      budget -= cost;
    }
  };

  await fillParents();
  if (targetAnchor) await fillTemporalNeighbors();

  // Siblings — other children of the same parents (skip in shallow mode)
  if (parents.length > 0 && contextDepth !== 'shallow') {
    const placeholders = parents.map(() => '?').join(', ');
    // DISTINCT + ORDER BY on a CASE expression that isn't in the select list is
    // rejected by Postgres ("for SELECT DISTINCT, ORDER BY expressions must
    // appear in select list") — the dedup happens in the inner query, then the
    // outer query is free to order by any expression since it has no DISTINCT.
    const siblingRows = await exec.all<Record<string, unknown>>(
      `SELECT * FROM (
         SELECT DISTINCT a.id, a.title, a.status, a.current_version_id, wbe.summary
         FROM article_links al
         JOIN articles a ON a.id = al.target_article_id
         LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
         WHERE al.source_article_id IN (${placeholders})
           AND al.link_type = 'hierarchical' AND a.id != ?
           AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ) sub
       ORDER BY ${STATUS_ORDER.replace(/a\.status/g, 'sub.status')}, sub.title
       LIMIT 6`,
      [...ownerParams(options.ownerId), ...parents.map((p) => p.id), articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of siblingRows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const { description, cost } = await withDeepDescription(r, `- ${r.title}: ${summary}\n`, budget);
      if (budget - cost < 0) break;
      siblings.push({ id: r.id as string, title: r.title as string, summary, description, source: buildContextSource(r) });
      budget -= cost;
    }
  }

  // Children tier for propose_children.
  if (mode === 'propose_children') {
    await fillChildren();
  }

  // Fixed points — skip in shallow mode (L2+)
  if (contextDepth !== 'shallow') {
    const fixedRows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id${ownerPredicate('wbe', options.ownerId)}
       WHERE ${worldOwnerPredicate('a', options.ownerId)} AND a.is_fixed_point = 1 AND a.id != ?
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 10`,
      [...ownerParams(options.ownerId), ...worldOwnerParams(worldId, options.ownerId), articleId],
    );

    for (const r of fixedRows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const cost = est(`### ${r.title}\n${summary}\n`);
      if (budget - cost < 0) break;
      fixedPoints.push({ id: r.id as string, title: r.title as string, summary, source: buildContextSource(r) });
      budget -= cost;
    }
  }

  // Referenced articles — titles only, skip in shallow mode
  if (contextDepth !== 'shallow') {
    const refRows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.current_version_id
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       WHERE al.source_article_id = ? AND al.link_type = 'references'
         AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       LIMIT 10`,
      [articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of refRows) {
      const cost = est(`- ${r.title}\n`);
      if (budget - cost < 0) break;
      referencedArticles.push({ id: r.id as string, title: r.title as string });
      dependencies.push(toDependency(
        { id: articleId, versionId: targetVersionId },
        { id: r.id as string, versionId: r.current_version_id as string | null },
        'reference',
      ));
      budget -= cost;
    }
  }

  return {
    targetId: articleId,
    targetVersionId,
    targetTitle,
    targetTemplateType,
    targetSubjectType,
    targetDescription,
    targetChronology,
    targetIntroduction,
    contextMode,
    parents,
    siblings,
    children,
    fixedPoints,
    temporalNeighbors,
    referencedArticles,
    dependencies,
    contextBasis,
    contextDraftIds: [...contextDraftIds],
    estimatedTokens: maxTokens - budget,
  };
}
