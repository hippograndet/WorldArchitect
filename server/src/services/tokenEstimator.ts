import { getDb } from '../db/index.js';
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
  extraText: string = '',
): Promise<number> {
  const bible = renderBible(worldId);
  const combined = [bible, extraText].filter(Boolean).join('\n\n');
  return countTokens(combined);
}

/**
 * Recompute and persist the world Bible's token count using the real provider
 * API when available. Replaces the char-based estimate written by Block 4's
 * refreshTokenCount() in worldBible.ts.
 */
export async function updateBibleTokenCount(worldId: string): Promise<number> {
  const rendered = renderBible(worldId);
  const count = await countTokens(rendered);

  getDb()
    .prepare('UPDATE world_bible_meta SET token_count = ?, updated_at = ? WHERE world_id = ?')
    .run(count, Date.now(), worldId);

  return count;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function countTokens(text: string): Promise<number> {
  if (!isLLMConfigured()) return charBasedEstimate(text);
  try {
    return await getProvider().estimateTokens(text);
  } catch {
    return charBasedEstimate(text);
  }
}

function charBasedEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}
