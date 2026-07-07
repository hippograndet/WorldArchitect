import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';
import { redactSecrets } from '../security/redaction.js';

export interface CallLogEntry {
  worldId: string;
  agentType: string;
  articleId?: string;
  tokensIn?: number;
  tokensOut?: number;
  status: 'success' | 'error' | 'rejected';
  errorMessage?: string;
  /** Tool-loop round-trips the call took (see agents/base.ts's run() loop). */
  iterations?: number;
  /** Correlates every agent call within one pipeline-graph invocation (see graphs/pipelines/*.ts). */
  pipelineRunId?: string;
  pipelineType?: string;
}

export async function logCall(entry: CallLogEntry): Promise<void> {
  const exec = getDbClient();
  const ownerId = await ownerIdForWorld(exec, entry.worldId);
  await exec.run(`
      INSERT INTO call_log
        (id, world_id, owner_id, agent_type, article_id, tokens_in, tokens_out, status, error_message,
         iterations, pipeline_run_id, pipeline_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nanoid(),
      entry.worldId,
      ownerId,
      entry.agentType,
      entry.articleId ?? null,
      entry.tokensIn ?? null,
      entry.tokensOut ?? null,
      entry.status,
      entry.errorMessage ? String(redactSecrets(entry.errorMessage)) : null,
      entry.iterations ?? null,
      entry.pipelineRunId ?? null,
      entry.pipelineType ?? null,
      Date.now(),
    ]);
}

export async function getDailyCallCount(worldId: string, ownerId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const row = await getDbClient().get<{ count: number }>(`
      SELECT COUNT(*) AS count FROM call_log
      WHERE world_id = ? AND owner_id = ? AND status = 'success' AND created_at >= ?
    `, [worldId, ownerId, startOfDay.getTime()]);

  return row?.count ?? 0;
}

export async function checkDailyCap(worldId: string, ownerId: string): Promise<{
  allowed: boolean;
  current: number;
  cap: number | null;
}> {
  const settings = await getDbClient().get<{ daily_cap: number | null }>(
    'SELECT daily_cap FROM cost_settings WHERE world_id = ? AND owner_id = ?', [worldId, ownerId],
  );

  const cap = settings?.daily_cap ?? null;
  const current = await getDailyCallCount(worldId, ownerId);

  return { allowed: cap === null || current < cap, current, cap };
}
