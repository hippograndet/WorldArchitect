import { describe, it, expect } from 'vitest';
import { ContinuityEditorAgent } from './continuityEditor.js';
import { GroundingCheckAgent } from './groundingCheck.js';
import { DedupCheckAgent } from './dedupCheck.js';
import { CartographerAgent } from './cartographer.js';
import { ScribeAgent } from './scribe.js';
import type { BaseAgent } from './base.js';
import type { Tool } from '../tools/types.js';

/**
 * Regression net for per-agent context-tool access (dev-docs/mas_reference.md
 * "Context Tool Access"). getContextTools() is
 * protected; call it directly via a cast rather than exercising the full
 * run() loop, since only the tool list — not the tool-use behavior — is
 * under test here.
 */
function toolNames(agent: BaseAgent<unknown, unknown>): string[] {
  return ((agent as unknown as { getContextTools(): Tool[] }).getContextTools()).map((t) => t.name).sort();
}

describe('per-agent context-tool access', () => {
  it('Continuity Editor has zero context tools', () => {
    expect(toolNames(new ContinuityEditorAgent())).toEqual([]);
  });

  it('Grounding Check has get_article + search_articles only', () => {
    expect(toolNames(new GroundingCheckAgent())).toEqual(['get_article', 'search_articles']);
  });

  it('Dedup Check has get_article + search_articles only', () => {
    expect(toolNames(new DedupCheckAgent())).toEqual(['get_article', 'search_articles']);
  });

  it('Cartographer has lookup_names only (no independent retrieval — Dedup Check owns duplicate-checking)', () => {
    expect(toolNames(new CartographerAgent())).toEqual(['lookup_names']);
  });

  it('Scribe has lookup_names only (no independent retrieval — Researcher is the single upstream retrieval step)', () => {
    expect(toolNames(new ScribeAgent())).toEqual(['lookup_names']);
  });
});
