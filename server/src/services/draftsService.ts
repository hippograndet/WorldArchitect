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

export interface SavePendingDraftInput extends DraftTenantInput {
  selectedProposal?: Record<string, unknown>;
  pipelineType: 'expand_description' | 'create_root' | 'create_child' | 'reorganize';
  autoSelect?: boolean;
  expansionParams?: Record<string, unknown>;
  phase: 'draft_ready' | 'coherence_checked' | 'retention_checked' | 'done';
  contextPackage?: Record<string, unknown>;
  concepts?: Array<Record<string, unknown>>;
  parentUpdate?: { articleId: string; appendText: string };
  draftContent?: GeneratedDraftContent | Record<string, unknown>;
  matchPipelineType?: boolean;
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
    'SELECT * FROM pending_drafts WHERE article_id = ? AND owner_id = ?',
    [input.articleId, input.ownerId],
  );
  if (!row) throw new DraftServiceError('No pending draft', 404, 'NOT_FOUND');
  return parseDraft(row);
}

export async function savePendingDraft(input: SavePendingDraftInput) {
  await assertArticleExists(input);
  const exec = getDbClient();
  const now = Date.now();
  const selectedProposalJson = JSON.stringify(input.selectedProposal ?? {});
  const expansionParamsJson = JSON.stringify(input.expansionParams ?? {});
  const where = input.matchPipelineType
    ? 'article_id = ? AND owner_id = ? AND pipeline_type = ?'
    : 'article_id = ? AND owner_id = ?';
  const whereParams = input.matchPipelineType
    ? [input.articleId, input.ownerId, input.pipelineType]
    : [input.articleId, input.ownerId];

  const existing = await exec.get<DbRow>(`SELECT id FROM pending_drafts WHERE ${where}`, whereParams);
  if (existing) {
    await exec.run(`
      UPDATE pending_drafts
      SET selected_proposal = ?, draft_content = ?, expansion_params = ?,
          phase = ?, pipeline_type = ?, auto_select = ?,
          context_package = ?, concepts = ?, parent_update = ?, updated_at = ?
      WHERE ${where}
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
      now,
      ...whereParams,
    ]);
  } else {
    await exec.run(`
      INSERT INTO pending_drafts
        (id, article_id, owner_id, selected_proposal, draft_content, expansion_params,
         phase, pipeline_type, auto_select, context_package, concepts, parent_update,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nanoid(),
      input.articleId,
      input.ownerId,
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

  const row = await exec.get<DbRow>(`SELECT * FROM pending_drafts WHERE ${where}`, whereParams);
  return parseDraft(row!);
}

export async function discardPendingDraft(input: DraftTenantInput): Promise<void> {
  await assertArticleExists(input);
  await getDbClient().run(
    'DELETE FROM pending_drafts WHERE article_id = ? AND owner_id = ?',
    [input.articleId, input.ownerId],
  );
}
