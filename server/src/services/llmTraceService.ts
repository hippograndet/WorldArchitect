import { nanoid } from 'nanoid';
import { getAppMode } from '../config.js';
import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';
import { redactSecrets } from '../security/redaction.js';
import type { ChatMessage, CompletionOptions, CompletionResult, ProviderName } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

export interface LlmTraceRow {
  id: string;
  runId: string | null;
  articleId: string | null;
  agentType: string;
  provider: string;
  iteration: number;
  status: string;
  request: unknown;
  response: unknown;
  errorMessage: string | null;
  createdAt: number;
}

export function isLlmTraceEnabled(): boolean {
  if (process.env.WORLDARCHITECT_LLM_TRACE !== '1') return false;
  if (process.env.NODE_ENV === 'production' && getAppMode() !== 'local') return false;
  return true;
}

export async function logLlmTrace(entry: {
  worldId: string;
  agentType: string;
  articleId?: string;
  runId?: string;
  provider: ProviderName;
  iteration: number;
  status: 'success' | 'error';
  messages: ChatMessage[];
  options: CompletionOptions;
  tools: Tool[];
  response?: CompletionResult;
  errorMessage?: string;
}): Promise<void> {
  if (!isLlmTraceEnabled()) return;

  const exec = getDbClient();
  const ownerId = await ownerIdForWorld(exec, entry.worldId);
  const request = redactSecrets({
    messages: entry.messages,
    options: entry.options,
    tools: entry.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });
  const response = entry.response ? redactSecrets(entry.response) : null;
  const errorMessage = entry.errorMessage ? String(redactSecrets(entry.errorMessage)) : null;

  await exec.run(
    `INSERT INTO llm_traces
       (id, owner_id, world_id, run_id, article_id, agent_type, provider, iteration, status,
        request_json, response_json, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      ownerId,
      entry.worldId,
      entry.runId ?? null,
      entry.articleId ?? null,
      entry.agentType,
      entry.provider,
      entry.iteration,
      entry.status,
      JSON.stringify(request),
      response ? JSON.stringify(response) : null,
      errorMessage,
      Date.now(),
    ],
  );
}

export async function listRunLlmTraces(
  worldId: string,
  ownerId: string,
  runId: string,
  limit = 50,
): Promise<LlmTraceRow[]> {
  if (!isLlmTraceEnabled()) return [];

  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT lt.*
       FROM llm_traces lt
       JOIN runs r ON r.id = lt.run_id
      WHERE lt.run_id = ? AND lt.world_id = ? AND lt.owner_id = ?
        AND r.world_id = lt.world_id AND r.owner_id = lt.owner_id
      ORDER BY lt.created_at DESC
      LIMIT ?`,
    [runId, worldId, ownerId, limit],
  );

  return rows.map((row) => ({
    id: row.id as string,
    runId: (row.run_id as string | null) ?? null,
    articleId: (row.article_id as string | null) ?? null,
    agentType: row.agent_type as string,
    provider: row.provider as string,
    iteration: row.iteration as number,
    status: row.status as string,
    request: parseJson(row.request_json),
    response: parseJson(row.response_json),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as number,
  }));
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
