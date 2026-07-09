import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { AppError } from '../middleware/errorHandler.js';

export type RunReviewKind = 'intro_review' | 'draft_review' | 'child_selection' | 'proposal_selection' | 'idea_selection';
export type RunReviewStatus = 'pending' | 'accepted' | 'rejected';

export interface RunReviewItemRow {
  id: string;
  worldId: string;
  ownerId: string;
  runId: string;
  articleId: string | null;
  step: string;
  kind: RunReviewKind | string;
  status: RunReviewStatus | string;
  payload: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseReview(row: Record<string, unknown>): RunReviewItemRow {
  const decision = row.decision_json ? parseJsonObject(row.decision_json) : null;
  return {
    id: row.id as string,
    worldId: row.world_id as string,
    ownerId: row.owner_id as string,
    runId: row.run_id as string,
    articleId: (row.article_id as string | null) ?? null,
    step: row.step as string,
    kind: row.kind as string,
    status: row.status as string,
    payload: parseJsonObject(row.payload_json),
    decision,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export async function createRunReviewItem(params: {
  worldId: string;
  ownerId: string;
  runId: string;
  articleId?: string;
  step: string;
  kind: RunReviewKind;
  payload: Record<string, unknown>;
}): Promise<RunReviewItemRow> {
  const exec = getDbClient();
  const now = Date.now();
  const existing = await exec.get<Record<string, unknown>>(
    `SELECT * FROM run_review_items
      WHERE world_id = ? AND owner_id = ? AND run_id = ? AND article_id IS NOT DISTINCT FROM ? AND kind = ? AND status = 'pending'`,
    [params.worldId, params.ownerId, params.runId, params.articleId ?? null, params.kind],
  );
  if (existing) return parseReview(existing);

  const id = nanoid();
  await exec.run(
    `INSERT INTO run_review_items
       (id, owner_id, world_id, run_id, article_id, step, kind, status, payload_json, created_at, updated_at)
     SELECT ?, r.owner_id, r.world_id, r.id, ?, ?, ?, 'pending', ?, ?, ?
       FROM runs r
      WHERE r.id = ? AND r.world_id = ? AND r.owner_id = ?`,
    [
      id,
      params.articleId ?? null,
      params.step,
      params.kind,
      JSON.stringify(params.payload),
      now,
      now,
      params.runId,
      params.worldId,
      params.ownerId,
    ],
  );
  const created = await getRunReviewItem(params.worldId, params.ownerId, params.runId, id);
  if (!created) throw new Error('Failed to create run review item');
  return created;
}

export async function listRunReviewItems(worldId: string, ownerId: string, runId: string): Promise<RunReviewItemRow[]> {
  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT ri.*
       FROM run_review_items ri
       JOIN runs r ON r.id = ri.run_id
      WHERE ri.run_id = ? AND ri.world_id = ? AND ri.owner_id = ?
        AND r.world_id = ri.world_id AND r.owner_id = ri.owner_id
      ORDER BY ri.created_at DESC`,
    [runId, worldId, ownerId],
  );
  return rows.map(parseReview);
}

export async function getRunReviewItem(
  worldId: string,
  ownerId: string,
  runId: string,
  reviewId: string,
): Promise<RunReviewItemRow | null> {
  const row = await getDbClient().get<Record<string, unknown>>(
    `SELECT ri.*
       FROM run_review_items ri
       JOIN runs r ON r.id = ri.run_id
      WHERE ri.id = ? AND ri.run_id = ? AND ri.world_id = ? AND ri.owner_id = ?
        AND r.world_id = ri.world_id AND r.owner_id = ri.owner_id`,
    [reviewId, runId, worldId, ownerId],
  );
  return row ? parseReview(row) : null;
}

export async function decideRunReviewItem(params: {
  worldId: string;
  ownerId: string;
  runId: string;
  reviewId: string;
  status: Extract<RunReviewStatus, 'accepted' | 'rejected'>;
  decision?: Record<string, unknown>;
}): Promise<RunReviewItemRow> {
  const existing = await getRunReviewItem(params.worldId, params.ownerId, params.runId, params.reviewId);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review item not found');
  if (existing.status !== 'pending') throw new AppError(409, 'REVIEW_ALREADY_RESOLVED', 'Review item is already resolved');

  await getDbClient().run(
    `UPDATE run_review_items
        SET status = ?, decision_json = ?, updated_at = ?
      WHERE id = ? AND run_id = ? AND world_id = ? AND owner_id = ?`,
    [
      params.status,
      JSON.stringify(params.decision ?? {}),
      Date.now(),
      params.reviewId,
      params.runId,
      params.worldId,
      params.ownerId,
    ],
  );
  return (await getRunReviewItem(params.worldId, params.ownerId, params.runId, params.reviewId))!;
}

export async function getLatestReviewDecision(params: {
  worldId: string;
  ownerId: string;
  runId: string;
  articleId?: string;
  kind: RunReviewKind;
}): Promise<RunReviewItemRow | null> {
  const row = await getDbClient().get<Record<string, unknown>>(
    `SELECT *
       FROM run_review_items
      WHERE world_id = ? AND owner_id = ? AND run_id = ?
        AND article_id IS NOT DISTINCT FROM ?
        AND kind = ? AND status IN ('accepted', 'rejected')
      ORDER BY updated_at DESC
      LIMIT 1`,
    [params.worldId, params.ownerId, params.runId, params.articleId ?? null, params.kind],
  );
  return row ? parseReview(row) : null;
}
