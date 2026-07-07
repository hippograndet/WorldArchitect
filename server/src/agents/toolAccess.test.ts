import { describe, it, expect } from 'vitest';
import { ContinuityEditorAgent } from './continuityEditor.js';
import { GroundingCheckAgent } from './groundingCheck.js';
import { DedupCheckAgent } from './dedupCheck.js';
import { CartographerAgent } from './cartographer.js';
import { ScribeAgent } from './scribe.js';
import type { BaseAgent } from './base.js';
import type { Tool } from '../tools/types.js';

/**
 * Regression net for the v8 tool-access rework (dev-docs/mas_reference.md
 * "Context Tool Access") — nothing previously asserted on any agent's actual
 * getContextTools() output, so a future refactor could silently widen or
 * narrow an agent's tool access with no test failure. getContextTools() is
 * protected; call it directly via a cast rather than exercising the full
 * run() loop, since only the tool list — not the tool-use behavior — is
 * under test here.
 */
function toolNames(agent: BaseAgent<unknown, unknown>): string[] {
  return ((agent as unknown as { getContextTools(): Tool[] }).getContextTools()).map((t) => t.name).sort();
}

describe('per-agent context-tool access (v8 rework)', () => {
  it('Continuity Editor has zero context tools', () => {
    expect(toolNames(new ContinuityEditorAgent())).toEqual([]);
  });

  it('Grounding Check has get_article + search_articles only', () => {
    expect(toolNames(new GroundingCheckAgent())).toEqual(['get_article', 'search_articles']);
  });

  it('Dedup Check has get_article + search_articles only', () => {
    expect(toolNames(new DedupCheckAgent())).toEqual(['get_article', 'search_articles']);
  });

  it('Cartographer has lookup_names + search_articles', () => {
    expect(toolNames(new CartographerAgent())).toEqual(['lookup_names', 'search_articles']);
  });

  it('Scribe has search_articles + lookup_names only (not the full context-tool set)', () => {
    expect(toolNames(new ScribeAgent())).toEqual(['lookup_names', 'search_articles']);
  });
});
