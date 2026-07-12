import { getDbClient } from '../db/client.js';
import { getProvider, isLLMConfigured } from '../providers/index.js';
import { renderBible } from './worldBible.js';

/**
 * Estimate the input token cost of a call that includes the world Bible plus
 * extra text (e.g., article title + expansion params).
 * Uses the active provider's counting API when available, otherwise falls back
 * to the char-based approximation (~4 chars per token).
 */
export async function estimateCallTokens(
  worldId: string,
  ownerId?: string,
  extraText: string = '',
): Promise<number> {
  const bible = await renderBible(worldId, ownerId);
  const combined = [bible, extraText].filter(Boolean).join('\n\n');
  return countTokens(combined);
}

/**
 * Recompute and persist the world Bible's token count using the real provider
 * API when available. Replaces the char-based estimate written by Block 4's
 * refreshTokenCount() in worldBible.ts.
 */
export async function updateBibleTokenCount(worldId: string, ownerId?: string): Promise<number> {
  const rendered = await renderBible(worldId, ownerId);
  const count = await countTokens(rendered);

  await getDbClient().run(
    `UPDATE world_bible_meta SET token_count = ?, updated_at = ? WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''}`,
    ownerId ? [count, Date.now(), worldId, ownerId] : [count, Date.now(), worldId],
  );

  return count;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function countTokens(text: string): Promise<number> {
  if (!(await isLLMConfigured())) return charBasedEstimate(text);
  try {
    const provider = await getProvider();
    return await provider.estimateTokens(text);
  } catch {
    return charBasedEstimate(text);
  }
}

function charBasedEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}
