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

/** Table 1's WorldInfoContext: the always-on {worldId, title, introduction} tier, sourced from the world's root article. */
export interface WorldInfoContext {
  worldId: string;
  title: string;
  introduction: string;
}

export type ArchivistMode =
  | 'default'
  | 'propose_children'    // children tier added (see what already exists)
  | 'reorganize';         // no distinct effect inside buildContextPackage() itself; reorganize-specific prompt behavior lives in its callers (e.g. prompts/expander.ts's own ExpanderMode), not here

export type ContextDepth = 'shallow' | 'mid' | 'deep';

export interface ArchivistOptions {
  ownerId: string;
  mode?: ArchivistMode;
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
}

// ---------------------------------------------------------------------------
// Hop-count reach — contextDepth sets how many graph hops buildContextPackage
// traverses (closest/medium/farthest below), not a token ceiling. Field detail
// per tier is fixed regardless of reach (an included tier is always rendered
// at its own detail level); reach only controls which tiers get included at
// all, so "deep" is strictly a superset of "mid", which is a superset of
// "shallow".
// ---------------------------------------------------------------------------

const HOP_REACH: Record<ContextDepth, number> = { shallow: 1, mid: 2, deep: 3 };

// ---------------------------------------------------------------------------
// Token estimation (char-based, no API call) — informational only (surfaced
// via ContextPackage.estimatedTokens for cost telemetry). Reach, not budget,
// decides what's included; this never gates inclusion.
// ---------------------------------------------------------------------------

function est(text: string): number {
  return Math.ceil(text.length / 4);
}

function estArticle(a: ContextArticle): number {
  return est(a.title) + est(a.summary) + est(a.description ?? '');
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
// WorldInfoContext
// ---------------------------------------------------------------------------

/**
 * The always-on world identity tier: {worldId, title, introduction} from the
 * world's root article (worlds.root_article_id, set at creation time and
 * backfilled per-world as "the article with no incoming hierarchical link").
 */
export async function getWorldInfoContext(worldId: string, ownerId?: string): Promise<WorldInfoContext> {
  const exec = getDbClient();

  const row = await exec.get<Record<string, unknown>>(
    `SELECT a.title, av.introduction
     FROM worlds w
     JOIN articles a ON a.id = w.root_article_id${ownerPredicate('a', ownerId)}
     LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', ownerId)}
     WHERE w.id = ?${ownerPredicate('w', ownerId)}`,
    [...ownerParams(ownerId), ...ownerParams(ownerId), worldId, ...ownerParams(ownerId)],
  );

  if (!row) throw new Error(`World ${worldId} has no root article configured`);

  return {
    worldId,
    title: (row.title as string) ?? '',
    introduction: (row.introduction as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

/**
 * Build a tiered context package for a given article, reach- and
 * hop-distance-tiered rather than token-budget-trimmed:
 *
 *   - closest  (1 hop:  parents, children)         → {title, introduction, description}
 *   - medium   (2 hops: siblings)                   → {title, introduction}
 *   - farthest (fixed points, referenced articles)  → {title} only
 *
 * contextDepth sets reach (how many of the tiers above get included at all —
 * shallow: closest only; mid: closest + medium; deep: all three), not a
 * token ceiling. An included tier always renders at its own fixed detail
 * level regardless of reach, so nothing is silently truncated by a budget
 * running out — "deep" is strictly a superset of "mid", a superset of
 * "shallow".
 *
 * Mode override: propose_children — children tier added (also closest/1-hop).
 */
export async function buildContextPackage(
  worldId: string,
  articleId: string,
  options: ArchivistOptions,
): Promise<ContextPackage> {
  const exec = getDbClient();
  const { mode = 'default', contextDepth = 'mid', contextBasis = 'current' } = options;
  const reach = HOP_REACH[contextDepth];

  // Fetch target
  const target = await exec.get<Record<string, unknown>>(
    `SELECT a.id, a.title, a.template_type, a.status, a.current_version_id,
            av.introduction, av.description
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', options.ownerId)}
     WHERE a.id = ? AND ${worldOwnerPredicate('a', options.ownerId)}`,
    [...ownerParams(options.ownerId), articleId, ...worldOwnerParams(worldId, options.ownerId)],
  );

  if (!target) throw new Error(`Article ${articleId} not found in world ${worldId}`);

  let targetDescription = (target.description as string) ?? '';
  const targetChronology = '';
  let targetIntroduction = (target.introduction as string) ?? '';
  const targetTitle = target.title as string;
  const targetTemplateType = target.template_type as string;
  const targetVersionId = (target.current_version_id as string | null) ?? null;
  const targetSubjectType = toSubjectType(targetTemplateType);
  const contextMode = toContextMode((target.status as string | null) ?? null);

  const dependencies: ArticleDependencyReference[] = [];

  const contextDraftIds = new Set<string>();
  const latestDraftCache = new Map<string, Record<string, unknown> | undefined>();
  const publishedVersionCache = new Map<string, { id: string; introduction: string; description: string } | undefined>();

  // Exact, unambiguous lookup via articles.published_version_id — a single
  // pointer, not a scan over a flag that could (before this) end up set on
  // more than one version of the same article.
  const publishedVersionFor = async (targetArticleId: string): Promise<{ id: string; introduction: string; description: string } | undefined> => {
    if (contextBasis !== 'published') return undefined;
    if (publishedVersionCache.has(targetArticleId)) return publishedVersionCache.get(targetArticleId);
    const row = await exec.get<{ id: string; introduction: string; description: string }>(
      `SELECT av.id, av.introduction, av.description
       FROM articles a
       JOIN article_versions av ON av.id = a.published_version_id
       WHERE a.id = ?${ownerPredicate('a', options.ownerId)}`,
      [targetArticleId, ...ownerParams(options.ownerId)],
    );
    publishedVersionCache.set(targetArticleId, row);
    return row;
  };

  // Resolves which version id actually backed a piece of substituted text —
  // the published version's own id when contextBasis is 'published' and one
  // exists, null when it doesn't (never silently falls back to current: an
  // unpublished article under a published-basis run has no version to point
  // at, same as its text being treated as empty), otherwise the fallback.
  const resolveVersionIdFor = async (targetArticleId: string, fallbackVersionId: string | null): Promise<string | null> => {
    if (contextBasis !== 'published') return fallbackVersionId;
    const published = await publishedVersionFor(targetArticleId);
    return published?.id ?? null;
  };

  const resolveContextSource = async (row: Record<string, unknown>): Promise<ArticleContextSource> => {
    const base = buildContextSource(row);
    const versionId = await resolveVersionIdFor(row.id as string, base.versionId ?? null);
    return { ...base, versionId };
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

  // Published basis is a hard switch, not another fallback tier: an article
  // with no published version is treated as empty (a stub), not silently
  // read from its current draft — that's what makes "Forge on published"
  // mean "the Bible only shows published content" for every article pulled
  // into context, not just the one being edited.
  const draftIntroductionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    if (contextBasis === 'published') {
      const published = await publishedVersionFor(targetArticleId);
      return published?.introduction ?? '';
    }
    const draft = await latestDraftFor(targetArticleId);
    const content = parseDraftContent(draft);
    return draftString(content, 'introduction') ?? draftString(content, 'childDescription') ?? fallback;
  };

  const draftDescriptionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    if (contextBasis === 'published') {
      const published = await publishedVersionFor(targetArticleId);
      return published?.description ?? '';
    }
    const draft = await latestDraftFor(targetArticleId);
    const content = parseDraftContent(draft);
    return draftString(content, 'description') ?? draftString(content, 'childDescription') ?? fallback;
  };

  const contextSummaryFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    return draftIntroductionFor(targetArticleId, fallback);
  };

  const contextDescriptionFor = async (targetArticleId: string, fallback: string): Promise<string> => {
    return draftDescriptionFor(targetArticleId, fallback);
  };

  targetIntroduction = await draftIntroductionFor(articleId, targetIntroduction);
  targetDescription = await draftDescriptionFor(articleId, targetDescription);
  const resolvedTargetVersionId = await resolveVersionIdFor(articleId, targetVersionId);

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

  // Status ordering: published > reviewed > draft > stub (anything else last)
  const STATUS_ORDER = `CASE a.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END`;

  // Parents — closest tier (1 hop), always full detail. Reach doesn't gate
  // this tier (it's included whenever reach >= 1, i.e. always); shallow just
  // keeps the list shorter, a cardinality cap unrelated to reach/detail.
  const fillParents = async (): Promise<void> => {
    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id, av.introduction AS summary
       FROM article_links al
       JOIN articles a ON a.id = al.source_article_id
       LEFT JOIN article_versions av ON av.id = a.current_version_id
       WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
         AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT ${contextDepth === 'shallow' ? 2 : 4}`,
      [articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of rows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const description = await fetchDescription(r.id as string);
      parents.push({ id: r.id as string, title: r.title as string, summary, description, source: await resolveContextSource(r) });
      dependencies.push(toDependency(
        { id: r.id as string, versionId: await resolveVersionIdFor(r.id as string, r.current_version_id as string | null) },
        { id: articleId, versionId: resolvedTargetVersionId },
        'hierarchy',
      ));
    }
  };

  // Children — also closest tier (1 hop), same full detail as parents.
  // Gated only by mode (propose_children), not by reach: a direct child is
  // exactly as close as a direct parent, so shallow reach doesn't exclude it.
  const fillChildren = async (): Promise<void> => {
    const rows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id, av.introduction AS summary
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       LEFT JOIN article_versions av ON av.id = a.current_version_id
       WHERE al.source_article_id = ? AND al.link_type = 'hierarchical'
         AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 12`,
      [articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of rows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      const description = await fetchDescription(r.id as string);
      children.push({ id: r.id as string, title: r.title as string, summary, description, source: await resolveContextSource(r) });
      dependencies.push(toDependency(
        { id: articleId, versionId: resolvedTargetVersionId },
        { id: r.id as string, versionId: await resolveVersionIdFor(r.id as string, r.current_version_id as string | null) },
        'hierarchy',
      ));
    }
  };

  await fillParents();

  // Siblings — medium tier (2 hops, via a shared parent): title+introduction
  // only, never description. Gated by reach >= 2 (mid and deep; not shallow).
  if (parents.length > 0 && reach >= 2) {
    const placeholders = parents.map(() => '?').join(', ');
    // DISTINCT + ORDER BY on a CASE expression that isn't in the select list is
    // rejected by Postgres ("for SELECT DISTINCT, ORDER BY expressions must
    // appear in select list") — the dedup happens in the inner query, then the
    // outer query is free to order by any expression since it has no DISTINCT.
    const siblingRows = await exec.all<Record<string, unknown>>(
      `SELECT * FROM (
         SELECT DISTINCT a.id, a.title, a.status, a.current_version_id, av.introduction AS summary
         FROM article_links al
         JOIN articles a ON a.id = al.target_article_id
         LEFT JOIN article_versions av ON av.id = a.current_version_id
         WHERE al.source_article_id IN (${placeholders})
           AND al.link_type = 'hierarchical' AND a.id != ?
           AND ${worldOwnerPredicate('a', options.ownerId)}${ownerPredicate('al', options.ownerId)}
       ) sub
       ORDER BY ${STATUS_ORDER.replace(/a\.status/g, 'sub.status')}, sub.title
       LIMIT 6`,
      [...parents.map((p) => p.id), articleId, ...worldOwnerParams(worldId, options.ownerId), ...ownerParams(options.ownerId)],
    );

    for (const r of siblingRows) {
      const summary = await contextSummaryFor(r.id as string, (r.summary as string) ?? '');
      siblings.push({ id: r.id as string, title: r.title as string, summary, source: await resolveContextSource(r) });
    }
  }

  // Children tier for propose_children — closest/1-hop, so not reach-gated.
  if (mode === 'propose_children') {
    await fillChildren();
  }

  // Fixed points — farthest tier (title only, no introduction/description):
  // not graph-adjacent to the target at all, so under hop-reach semantics
  // they only surface at the deepest reach. Gated by reach >= 3 (deep only).
  if (reach >= 3) {
    const fixedRows = await exec.all<Record<string, unknown>>(
      `SELECT a.id, a.title, a.status, a.current_version_id
       FROM articles a
       WHERE ${worldOwnerPredicate('a', options.ownerId)} AND a.is_fixed_point = 1 AND a.id != ?
       ORDER BY ${STATUS_ORDER}, a.title
       LIMIT 10`,
      [...worldOwnerParams(worldId, options.ownerId), articleId],
    );

    for (const r of fixedRows) {
      fixedPoints.push({ id: r.id as string, title: r.title as string, summary: '', source: await resolveContextSource(r) });
    }
  }

  // Referenced articles — also farthest tier (title only, already the case
  // pre-rewrite). Gated by reach >= 3 (deep only), same as fixed points.
  if (reach >= 3) {
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
      referencedArticles.push({ id: r.id as string, title: r.title as string });
      dependencies.push(toDependency(
        { id: articleId, versionId: resolvedTargetVersionId },
        { id: r.id as string, versionId: await resolveVersionIdFor(r.id as string, r.current_version_id as string | null) },
        'reference',
      ));
    }
  }

  const estimatedTokens = est(targetIntroduction) + est(targetDescription)
    + parents.reduce((sum, a) => sum + estArticle(a), 0)
    + siblings.reduce((sum, a) => sum + estArticle(a), 0)
    + children.reduce((sum, a) => sum + estArticle(a), 0)
    + fixedPoints.reduce((sum, a) => sum + estArticle(a), 0)
    + referencedArticles.reduce((sum, r) => sum + est(r.title), 0);

  return {
    targetId: articleId,
    targetVersionId: resolvedTargetVersionId,
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
    estimatedTokens,
  };
}
