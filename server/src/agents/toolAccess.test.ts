import { describe, it, expect } from 'vitest';
import { ArbiterAgent } from './arbiter.js';
import { GatekeeperAgent } from './gatekeeper.js';
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
  it('Arbiter has zero context tools', () => {
    expect(toolNames(new ArbiterAgent())).toEqual([]);
  });

  it('Gatekeeper has get_article + search_articles only', () => {
    expect(toolNames(new GatekeeperAgent())).toEqual(['get_article', 'search_articles']);
  });

  it('Cartographer has lookup_names only (no independent retrieval — Gatekeeper owns duplicate-checking)', () => {
    expect(toolNames(new CartographerAgent())).toEqual(['lookup_names']);
  });

  it('Scribe has lookup_names only (no independent retrieval — Researcher is the single upstream retrieval step)', () => {
    expect(toolNames(new ScribeAgent())).toEqual(['lookup_names']);
  });
});
