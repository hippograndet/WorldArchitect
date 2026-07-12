import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { AppError } from '../middleware/errorHandler.js';

export interface RunRow {
  id: string;
  worldId: string;
  ownerId: string;
  status: string;
  graphType: string;
  checkpointId: string;
  articleIds: string[];
  budgetUsed: number;
  budgetLimit: number;
  config: Record<string, unknown>;
  errorMessage: string | null;
  itemsCompleted: number;
  itemsTotal: number;
  createdAt: number;
  updatedAt: number;
}

function parseRun(row: Record<string, unknown>): RunRow {
  const rawConfig = typeof row.run_config === 'string' ? row.run_config : '{}';
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawConfig) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    config = {};
  }

  return {
    id: row.id as string,
    worldId: row.world_id as string,
    ownerId: row.owner_id as string,
    status: row.status as string,
    graphType: row.graph_type as string,
    checkpointId: row.checkpoint_id as string,
    articleIds: JSON.parse((row.article_ids as string) || '[]'),
    budgetUsed: row.budget_used as number,
    budgetLimit: row.budget_limit as number,
    config,
    errorMessage: (row.error_message as string | null) ?? null,
    itemsCompleted: (row.items_completed as number | null) ?? 0,
    itemsTotal: (row.items_total as number | null) ?? 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/** Thrown when one or more target articles are already locked by a different active run. */
export class RunConflictError extends Error {
  constructor(public readonly lockedArticleIds: string[]) {
    super(`Article(s) already locked by another active run: ${lockedArticleIds.join(', ')}`);
  }
}

export async function createRun(params: {
  worldId: string;
  ownerId: string;
  articleIds: string[];
  budgetLimit?: number;
  graphType?: string;
  config?: Record<string, unknown>;
}): Promise<RunRow> {
  const exec = getDbClient();
  const now = Date.now();
  const runId = nanoid();
  const placeholders = params.articleIds.map(() => '?').join(',');

  await exec.transaction(async (tx) => {
    const locked = await tx.all<{ id: string }>(
      `SELECT id FROM articles WHERE world_id = ? AND owner_id = ? AND id IN (${placeholders}) AND locked_by_run_id IS NOT NULL`,
      [params.worldId, params.ownerId, ...params.articleIds],
    );
    if (locked.length > 0) throw new RunConflictError(locked.map((r) => r.id));

    await tx.run(
      `INSERT INTO runs
         (id, world_id, owner_id, status, graph_type, checkpoint_id, article_ids, budget_used, budget_limit, run_config, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        runId,
        params.worldId,
        params.ownerId,
        params.graphType ?? 'expand',
        runId,
        JSON.stringify(params.articleIds),
        params.budgetLimit ?? 200_000,
        JSON.stringify(params.config ?? {}),
        now,
        now,
      ],
    );

    for (const articleId of params.articleIds) {
      await tx.run(
        `UPDATE articles SET locked_by_run_id = ? WHERE id = ? AND world_id = ? AND owner_id = ?`,
        [runId, articleId, params.worldId, params.ownerId],
      );
    }
  });

  return (await getRun(params.worldId, params.ownerId, runId))!;
}

export async function getRun(worldId: string, ownerId: string, runId: string): Promise<RunRow | null> {
  const row = await getDbClient().get<Record<string, unknown>>(
    `SELECT * FROM runs WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [runId, worldId, ownerId],
  );
  return row ? parseRun(row) : null;
}

export async function listRuns(worldId: string, ownerId: string): Promise<RunRow[]> {
  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT * FROM runs WHERE world_id = ? AND owner_id = ? ORDER BY created_at DESC`,
    [worldId, ownerId],
  );
  return rows.map(parseRun);
}

export async function clearTerminalRunHistory(worldId: string, ownerId: string): Promise<{ deleted: number; retained: number }> {
  const exec = getDbClient();
  return exec.transaction(async (tx) => {
    const terminalRuns = await tx.all<{ id: string }>(
      `SELECT id FROM runs
       WHERE world_id = ? AND owner_id = ? AND status IN ('completed', 'failed', 'stopped')`,
      [worldId, ownerId],
    );
    const retainedRow = await tx.get<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM runs
       WHERE world_id = ? AND owner_id = ? AND status NOT IN ('completed', 'failed', 'stopped')`,
      [worldId, ownerId],
    );
    const retained = Number(retainedRow?.count ?? 0);

    const runIds = terminalRuns.map((run) => run.id);
    if (runIds.length === 0) return { deleted: 0, retained };

    const placeholders = runIds.map(() => '?').join(',');
    await tx.run(
      `DELETE FROM call_log
       WHERE world_id = ? AND owner_id = ? AND pipeline_run_id IN (${placeholders})`,
      [worldId, ownerId, ...runIds],
    );
    await tx.run(
      `DELETE FROM run_review_items
       WHERE world_id = ? AND owner_id = ? AND run_id IN (${placeholders})`,
      [worldId, ownerId, ...runIds],
    );
    await tx.run(`DELETE FROM checkpoint_writes WHERE thread_id IN (${placeholders})`, runIds);
    await tx.run(`DELETE FROM checkpoint_blobs WHERE thread_id IN (${placeholders})`, runIds);
    await tx.run(`DELETE FROM checkpoints WHERE thread_id IN (${placeholders})`, runIds);
    await tx.run(
      `DELETE FROM runs
       WHERE world_id = ? AND owner_id = ? AND id IN (${placeholders})`,
      [worldId, ownerId, ...runIds],
    );

    return { deleted: runIds.length, retained };
  });
}

export async function markRunStatus(
  worldId: string,
  ownerId: string,
  runId: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await getDbClient().run(
    `UPDATE runs SET status = ?, error_message = ?, updated_at = ?
     WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [status, errorMessage ?? null, Date.now(), runId, worldId, ownerId],
  );
}

export interface RunEventRow {
  id: string;
  step: string;
  title: string;
  ok: boolean;
  message: string | null;
  createdAt: number;
}

export interface RunAgentCallRow {
  id: string;
  articleId: string | null;
  agentType: string;
  status: string;
  errorMessage: string | null;
  iterations: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  pipelineType: string | null;
  createdAt: number;
}

/** Recent events for a run, newest first — mirrors ForgeLogEntry's existing client-side shape. */
export async function listRunEvents(worldId: string, ownerId: string, runId: string, limit = 200): Promise<RunEventRow[]> {
  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT re.id, re.step, re.title, re.ok, re.message, re.created_at
       FROM run_events re
       JOIN runs r ON r.id = re.run_id
      WHERE re.run_id = ? AND r.world_id = ? AND r.owner_id = ?
      ORDER BY re.created_at DESC
      LIMIT ?`,
    [runId, worldId, ownerId, limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    step: r.step as string,
    title: r.title as string,
    ok: Boolean(r.ok),
    message: (r.message as string | null) ?? null,
    createdAt: r.created_at as number,
  }));
}

export async function listRunAgentCalls(worldId: string, ownerId: string, runId: string, limit = 200): Promise<RunAgentCallRow[]> {
  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT cl.id, cl.article_id, cl.agent_type, cl.status, cl.error_message, cl.iterations,
            cl.tokens_in, cl.tokens_out, cl.pipeline_type, cl.created_at
       FROM call_log cl
       JOIN runs r ON r.id = cl.pipeline_run_id
      WHERE cl.pipeline_run_id = ? AND r.world_id = ? AND r.owner_id = ?
        AND cl.world_id = r.world_id AND cl.owner_id = r.owner_id
      ORDER BY cl.created_at ASC
      LIMIT ?`,
    [runId, worldId, ownerId, limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    articleId: (r.article_id as string | null) ?? null,
    agentType: r.agent_type as string,
    status: r.status as string,
    errorMessage: (r.error_message as string | null) ?? null,
    iterations: (r.iterations as number | null) ?? null,
    tokensIn: (r.tokens_in as number | null) ?? null,
    tokensOut: (r.tokens_out as number | null) ?? null,
    pipelineType: (r.pipeline_type as string | null) ?? null,
    createdAt: r.created_at as number,
  }));
}

/** Surfaces the Forge graph's queue progress for the client's forgeCompleted/forgeTotal UI. */
export async function updateRunProgress(
  worldId: string,
  ownerId: string,
  runId: string,
  itemsCompleted: number,
  itemsTotal: number,
): Promise<void> {
  await getDbClient().run(
    `UPDATE runs SET items_completed = ?, items_total = ?, updated_at = ?
     WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [itemsCompleted, itemsTotal, Date.now(), runId, worldId, ownerId],
  );
}

export async function bumpRunBudget(worldId: string, ownerId: string, runId: string, deltaTokens: number): Promise<void> {
  await getDbClient().run(
    `UPDATE runs SET budget_used = budget_used + ?, updated_at = ?
     WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [deltaTokens, Date.now(), runId, worldId, ownerId],
  );
}

export async function releaseLocks(worldId: string, ownerId: string, runId: string): Promise<void> {
  await getDbClient().run(
    `UPDATE articles SET locked_by_run_id = NULL
     WHERE world_id = ? AND owner_id = ? AND locked_by_run_id = ?`,
    [worldId, ownerId, runId],
  );
}

export async function cancelRun(worldId: string, ownerId: string, runId: string): Promise<RunRow | null> {
  const run = await getRun(worldId, ownerId, runId);
  if (!run) return null;
  await markRunStatus(worldId, ownerId, runId, 'stopped');
  await releaseLocks(worldId, ownerId, runId);
  return getRun(worldId, ownerId, runId);
}

/**
 * Fail-fast guard for manual agent routes (routes/agents.ts): reject before
 * spending an LLM call on an article an active Spark run already holds the
 * lock on. `articlesService.ts`'s `assertNotLocked` is the second,
 * defense-in-depth layer at the actual write chokepoint — this one exists
 * purely to avoid wasting a provider call on a request that would fail anyway.
 */
export async function assertArticleUnlocked(worldId: string, ownerId: string, articleId: string): Promise<void> {
  const row = await getDbClient().get<{ locked_by_run_id: string | null }>(
    `SELECT locked_by_run_id FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [articleId, worldId, ownerId],
  );
  if (row?.locked_by_run_id) {
    throw new AppError(409, 'ARTICLE_LOCKED', 'This article is locked by an in-progress run.', { articleId });
  }
}
