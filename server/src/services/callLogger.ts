import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { redactSecrets } from '../security/redaction.js';

export interface CallLogEntry {
  worldId: string;
  agentType: string;
  articleId?: string;
  tokensIn?: number;
  tokensOut?: number;
  status: 'success' | 'error' | 'rejected';
  errorMessage?: string;
}

export function logCall(entry: CallLogEntry): void {
  getDb()
    .prepare(`
      INSERT INTO call_log
        (id, world_id, agent_type, article_id, tokens_in, tokens_out, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      nanoid(),
      entry.worldId,
      entry.agentType,
      entry.articleId ?? null,
      entry.tokensIn ?? null,
      entry.tokensOut ?? null,
      entry.status,
      entry.errorMessage ? String(redactSecrets(entry.errorMessage)) : null,
      Date.now(),
    );
}

export function getDailyCallCount(worldId: string): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS count FROM call_log
      WHERE world_id = ? AND status = 'success' AND created_at >= ?
    `)
    .get(worldId, startOfDay.getTime()) as { count: number };

  return row.count;
}

export function checkDailyCap(worldId: string): {
  allowed: boolean;
  current: number;
  cap: number | null;
} {
  const settings = getDb()
    .prepare('SELECT daily_cap FROM cost_settings WHERE world_id = ?')
    .get(worldId) as { daily_cap: number | null } | undefined;

  const cap = settings?.daily_cap ?? null;
  const current = getDailyCallCount(worldId);

  return { allowed: cap === null || current < cap, current, cap };
}
