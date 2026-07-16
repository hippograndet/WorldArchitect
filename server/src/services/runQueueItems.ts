import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';

export type RunQueueItemStartStep = 'inception' | 'expansion' | 'branching';
export type RunQueueItemStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface RunQueueItemRow {
  id: string;
  worldId: string;
  ownerId: string;
  runId: string;
  articleId: string;
  title: string;
  depth: number;
  startStep: RunQueueItemStartStep;
  status: RunQueueItemStatus;
  createdAt: number;
  updatedAt: number;
}

function parseQueueItem(row: Record<string, unknown>): RunQueueItemRow {
  return {
    id: row.id as string,
    worldId: row.world_id as string,
    ownerId: row.owner_id as string,
    runId: row.run_id as string,
    articleId: row.article_id as string,
    title: row.title as string,
    depth: row.depth as number,
    startStep: row.start_step as RunQueueItemStartStep,
    status: row.status as RunQueueItemStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/** Mirrors a batch of ForgeQueueItems (forgeState.ts) into the durable table — called once for the root item (startForgeRun) and once per branching batch (branchingNode). */
export async function insertRunQueueItems(
  worldId: string,
  ownerId: string,
  runId: string,
  items: Array<{ articleId: string; title: string; depth: number; startStep: RunQueueItemStartStep }>,
): Promise<void> {
  if (items.length === 0) return;
  const exec = getDbClient();
  const now = Date.now();
  for (const item of items) {
    await exec.run(
      `INSERT INTO run_queue_items
         (id, owner_id, world_id, run_id, article_id, title, depth, start_step, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [nanoid(), ownerId, worldId, runId, item.articleId, item.title, item.depth, item.startStep, now, now],
    );
  }
}

export async function markRunQueueItemActive(worldId: string, ownerId: string, runId: string, articleId: string): Promise<void> {
  await getDbClient().run(
    `UPDATE run_queue_items SET status = 'active', updated_at = ?
      WHERE world_id = ? AND owner_id = ? AND run_id = ? AND article_id = ?`,
    [Date.now(), worldId, ownerId, runId, articleId],
  );
}

export async function markRunQueueItemFinished(
  worldId: string,
  ownerId: string,
  runId: string,
  articleId: string,
  status: Extract<RunQueueItemStatus, 'completed' | 'failed'>,
): Promise<void> {
  await getDbClient().run(
    `UPDATE run_queue_items SET status = ?, updated_at = ?
      WHERE world_id = ? AND owner_id = ? AND run_id = ? AND article_id = ?`,
    [status, Date.now(), worldId, ownerId, runId, articleId],
  );
}

export async function listRunQueueItems(worldId: string, ownerId: string, runId: string): Promise<RunQueueItemRow[]> {
  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT * FROM run_queue_items
      WHERE world_id = ? AND owner_id = ? AND run_id = ?
      ORDER BY seq ASC`,
    [worldId, ownerId, runId],
  );
  return rows.map(parseQueueItem);
}
