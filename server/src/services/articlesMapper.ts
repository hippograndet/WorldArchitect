import type { QueryExecutor } from '../db/executor.js';
import type { TenantContext } from '../tenant.js';

export type DbRow = Record<string, unknown>;

/** Article shell/identity fields — not versioned content. */
export interface ArticleRecord {
  id: unknown;
  worldId: unknown;
  title: unknown;
  status: unknown;
  templateType: unknown;
  depth: unknown;
  isFixedPoint: boolean;
  currentVersionId: unknown;
  publishedVersionId: unknown;
  lockedByRunId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

/** A single article_versions row as exposed to the API (history view). */
export interface ArticleVersionView {
  id: unknown;
  articleId: unknown;
  versionNumber: unknown;
  introduction: string;
  description: string;
  body: string;
  summary: string;
  expansionParams: unknown;
  proposalUsed: unknown;
  wordCount: unknown;
  isRevert: boolean;
  revertedFromVersionId: unknown;
  createdAt: unknown;
}

/** "The current content of an article" — whatever articles.current_version_id points at in article_versions. */
export interface ArticleContent {
  introduction: string;
  description: string;
  wordCount: number;
}

export function parseArticle(row: DbRow): ArticleRecord {
  return {
    id: row.id,
    worldId: row.world_id,
    title: row.title,
    status: row.status,
    templateType: row.template_type,
    depth: row.depth ?? 1,
    isFixedPoint: row.is_fixed_point === 1,
    currentVersionId: row.current_version_id ?? null,
    publishedVersionId: row.published_version_id ?? null,
    lockedByRunId: row.locked_by_run_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseVersion(row: DbRow): ArticleVersionView {
  const introduction = (row.introduction as string) ?? '';
  const description = (row.description as string) ?? '';
  const body = [
    introduction ? `## Introduction\n\n${introduction}` : '',
    description ? `## Description\n\n${description}` : '',
  ].filter(Boolean).join('\n\n');
  const summary = introduction || description.split(/\s+/).filter(Boolean).slice(0, 50).join(' ');

  return {
    id: row.id,
    articleId: row.article_id,
    versionNumber: row.version_number,
    introduction,
    description,
    body,
    summary,
    expansionParams: row.expansion_params
      ? JSON.parse(row.expansion_params as string)
      : null,
    proposalUsed: row.proposal_used
      ? JSON.parse(row.proposal_used as string)
      : null,
    wordCount: row.word_count,
    isRevert: row.is_revert === 1,
    revertedFromVersionId: row.reverted_from_version_id ?? null,
    createdAt: row.created_at,
  };
}

export function parseDraft(row: DbRow) {
  return {
    id: row.id,
    articleId: row.article_id,
    worldId: row.world_id ?? null,
    status: (row.status as string) ?? 'pending',
    sourceRunId: row.source_run_id ?? null,
    runType: (row.run_type as string | null) ?? (row.pipeline_type as string) ?? 'expand_description',
    contextBasis: (row.context_basis as string) ?? 'current',
    contextDraftIds: row.context_draft_ids ? JSON.parse(row.context_draft_ids as string) : [],
    displayTitle: row.display_title ?? null,
    selectedProposal: row.selected_proposal
      ? JSON.parse(row.selected_proposal as string)
      : null,
    pipelineType: (row.pipeline_type as string) ?? 'expand_description',
    autoSelect: row.auto_select === 1,
    expansionParams: row.expansion_params
      ? JSON.parse(row.expansion_params as string)
      : {},
    phase: row.phase,
    contextPackage: row.context_package
      ? JSON.parse(row.context_package as string)
      : null,
    concepts: row.concepts ? JSON.parse(row.concepts as string) : null,
    parentUpdate: row.parent_update
      ? JSON.parse(row.parent_update as string)
      : null,
    draftContent: row.draft_content
      ? JSON.parse(row.draft_content as string)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

export function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

export function bodyToDescription(body: string | undefined, fallback?: string): string | undefined {
  if (body === undefined) return fallback;
  return body
    .replace(/^##\s+Description\s*/i, '')
    .replace(/^##\s+Introduction\s*[\s\S]*?##\s+Description\s*/i, '')
    .trim();
}

export async function getNextVersionNumber(exec: QueryExecutor, articleId: string): Promise<number> {
  const row = await exec.get<{ max: number | null }>(
    'SELECT MAX(version_number) as max FROM article_versions WHERE article_id = ?',
    [articleId],
  );
  return (row?.max ?? 0) + 1;
}

export async function requireArticle(exec: QueryExecutor, worldId: string, articleId: string): Promise<DbRow | null> {
  return (await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND world_id = ?', [articleId, worldId])) ?? null;
}

export async function requireArticleForTenant(
  exec: QueryExecutor,
  tenant: Required<TenantContext>,
  articleId: string,
): Promise<DbRow | null> {
  return (await exec.get<DbRow>(
    'SELECT * FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?',
    [articleId, tenant.worldId, tenant.ownerId],
  )) ?? null;
}
