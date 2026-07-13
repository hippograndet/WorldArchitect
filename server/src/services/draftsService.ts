import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { parseDraft, requireArticleForTenant, type DbRow } from './articlesMapper.js';
import type { GeneratedDraftContent } from './articlesSchemas.js';

type DraftJson = Record<string, unknown> | unknown[] | null;

export class DraftServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export interface DraftTenantInput {
  worldId: string;
  ownerId: string;
  articleId: string;
}

export type DraftStatus = 'pending' | 'accepted' | 'discarded';
export type DraftStatusFilter = DraftStatus | 'all';
export type DraftContextBasis = 'current' | 'latest_draft' | 'published';

export interface SavePendingDraftInput extends DraftTenantInput {
  selectedProposal?: Record<string, unknown>;
  pipelineType: 'expand_description' | 'create_root' | 'create_child' | 'reorganize' | 'manual_edit';
  sourceRunId?: string;
  runType?: string;
  contextBasis?: DraftContextBasis;
  contextDraftIds?: string[];
  displayTitle?: string;
  autoSelect?: boolean;
  expansionParams?: Record<string, unknown>;
  phase: 'draft_ready' | 'coherence_checked' | 'retention_checked' | 'done';
  contextPackage?: Record<string, unknown>;
  concepts?: Array<Record<string, unknown>>;
  parentUpdate?: { articleId: string; appendText: string };
  draftContent?: GeneratedDraftContent | Record<string, unknown>;
  draftId?: string;
}

function jsonOrNull(value: DraftJson | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

async function assertArticleExists(input: DraftTenantInput): Promise<void> {
  const article = await requireArticleForTenant(getDbClient(), input, input.articleId);
  if (!article) throw new DraftServiceError('Article not found', 404, 'NOT_FOUND');
}

export async function getPendingDraft(input: DraftTenantInput) {
  await assertArticleExists(input);
  const row = await getDbClient().get<DbRow>(
    `SELECT * FROM pending_drafts
     WHERE article_id = ? AND owner_id = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.articleId, input.ownerId],
  );
  if (!row) throw new DraftServiceError('No pending draft', 404, 'NOT_FOUND');
  return parseDraft(row);
}

export async function listDrafts(input: DraftTenantInput & { status?: DraftStatusFilter }) {
  await assertArticleExists(input);
  const params: unknown[] = [input.articleId, input.ownerId];
  let sql = 'SELECT * FROM pending_drafts WHERE article_id = ? AND owner_id = ?';
  if (input.status && input.status !== 'all') {
    sql += ' AND status = ?';
    params.push(input.status);
  }
  sql += ` ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, created_at DESC`;
  const rows = await getDbClient().all<DbRow>(sql, params);
  return rows.map(parseDraft);
}

export async function getDraftById(input: DraftTenantInput & { draftId: string }) {
  await assertArticleExists(input);
  const row = await getDbClient().get<DbRow>(
    'SELECT * FROM pending_drafts WHERE id = ? AND article_id = ? AND owner_id = ?',
    [input.draftId, input.articleId, input.ownerId],
  );
  if (!row) throw new DraftServiceError('Draft not found', 404, 'NOT_FOUND');
  return parseDraft(row);
}

export async function savePendingDraft(input: SavePendingDraftInput) {
  await assertArticleExists(input);
  const exec = getDbClient();
  const now = Date.now();
  const selectedProposalJson = JSON.stringify(input.selectedProposal ?? {});
  const expansionParamsJson = JSON.stringify(input.expansionParams ?? {});
  const contextDraftIdsJson = JSON.stringify(input.contextDraftIds ?? []);
  const draftId = input.draftId ?? nanoid();

  const existing = input.draftId
    ? await exec.get<DbRow>(
      `SELECT id FROM pending_drafts WHERE id = ? AND article_id = ? AND owner_id = ? AND status = 'pending'`,
      [input.draftId, input.articleId, input.ownerId],
    )
    : null;
  if (existing) {
    await exec.run(`
      UPDATE pending_drafts
      SET selected_proposal = ?, draft_content = ?, expansion_params = ?,
          phase = ?, pipeline_type = ?, auto_select = ?,
          context_package = ?, concepts = ?, parent_update = ?,
          source_run_id = ?, run_type = ?, context_basis = ?, context_draft_ids = ?,
          display_title = ?, updated_at = ?
      WHERE id = ? AND article_id = ? AND owner_id = ? AND status = 'pending'
    `, [
      selectedProposalJson,
      jsonOrNull(input.draftContent),
      expansionParamsJson,
      input.phase,
      input.pipelineType,
      input.autoSelect ? 1 : 0,
      jsonOrNull(input.contextPackage),
      jsonOrNull(input.concepts),
      jsonOrNull(input.parentUpdate),
      input.sourceRunId ?? null,
      input.runType ?? input.pipelineType,
      input.contextBasis ?? 'current',
      contextDraftIdsJson,
      input.displayTitle ?? input.pipelineType,
      now,
      input.draftId,
      input.articleId,
      input.ownerId,
    ]);
  } else {
    await exec.run(`
      INSERT INTO pending_drafts
        (id, article_id, owner_id, world_id, status, source_run_id, run_type,
         context_basis, context_draft_ids, display_title,
         selected_proposal, draft_content, expansion_params,
         phase, pipeline_type, auto_select, context_package, concepts, parent_update,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      draftId,
      input.articleId,
      input.ownerId,
      input.worldId,
      input.sourceRunId ?? null,
      input.runType ?? input.pipelineType,
      input.contextBasis ?? 'current',
      contextDraftIdsJson,
      input.displayTitle ?? input.pipelineType,
      selectedProposalJson,
      jsonOrNull(input.draftContent),
      expansionParamsJson,
      input.phase,
      input.pipelineType,
      input.autoSelect ? 1 : 0,
      jsonOrNull(input.contextPackage),
      jsonOrNull(input.concepts),
      jsonOrNull(input.parentUpdate),
      now,
      now,
    ]);
  }

  const row = await exec.get<DbRow>(
    'SELECT * FROM pending_drafts WHERE id = ? AND article_id = ? AND owner_id = ?',
    [draftId, input.articleId, input.ownerId],
  );
  return parseDraft(row!);
}

export async function discardPendingDraft(input: DraftTenantInput): Promise<void> {
  await assertArticleExists(input);
  await getDbClient().run(
    `UPDATE pending_drafts SET status = 'discarded', resolved_at = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM pending_drafts
       WHERE article_id = ? AND owner_id = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1
     )`,
    [Date.now(), Date.now(), input.articleId, input.ownerId],
  );
}

export async function discardDraftById(input: DraftTenantInput & { draftId: string }): Promise<void> {
  await assertArticleExists(input);
  const now = Date.now();
  const result = await getDbClient().run(
    `UPDATE pending_drafts
     SET status = 'discarded', resolved_at = ?, updated_at = ?
     WHERE id = ? AND article_id = ? AND owner_id = ? AND status = 'pending'`,
    [now, now, input.draftId, input.articleId, input.ownerId],
  );
  if (result.changes === 0) throw new DraftServiceError('Draft not found', 404, 'NOT_FOUND');
}

export async function markDraftAccepted(input: DraftTenantInput & { draftId: string; exec?: { run: (...args: any[]) => Promise<any> } }): Promise<void> {
  const now = Date.now();
  const runner = input.exec ?? getDbClient();
  await runner.run(
    `UPDATE pending_drafts
     SET status = 'accepted', resolved_at = ?, updated_at = ?
     WHERE id = ? AND article_id = ? AND owner_id = ? AND status = 'pending'`,
    [now, now, input.draftId, input.articleId, input.ownerId],
  );
}

export async function findLatestPendingDraftRows(input: {
  worldId: string;
  ownerId?: string;
  articleIds: string[];
}): Promise<Map<string, DbRow>> {
  if (input.articleIds.length === 0) return new Map();
  const placeholders = input.articleIds.map(() => '?').join(', ');
  const ownerSql = input.ownerId ? 'AND owner_id = ?' : '';
  const params: unknown[] = [input.worldId, ...input.articleIds];
  if (input.ownerId) params.push(input.ownerId);
  const rows = await getDbClient().all<DbRow>(
    `SELECT * FROM pending_drafts
     WHERE world_id = ? AND article_id IN (${placeholders}) ${ownerSql}
       AND status = 'pending'
     ORDER BY article_id, created_at DESC`,
    params,
  );
  const out = new Map<string, DbRow>();
  for (const row of rows) {
    const articleId = row.article_id as string;
    if (!out.has(articleId)) out.set(articleId, row);
  }
  return out;
}

export async function latestPendingDraftIdsForContext(input: {
  worldId: string;
  ownerId?: string;
  articleIds: string[];
}): Promise<string[]> {
  const rows = await findLatestPendingDraftRows(input);
  return [...rows.values()].map((row) => row.id as string);
}
