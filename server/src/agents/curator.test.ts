import { describe, expect, it } from 'vitest';
import { CuratorAgent, type CuratorInput } from './curator.js';
import type { ProposalItem } from './muse.js';
import type { WorldContext } from './director.js';

const worldContext: WorldContext = {
  worldId: 'world-1',
  name: 'Test World',
  tone: 'neutral',
  originPoint: null,
  styleConfig: null,
};

function makeInput(proposalCount: number): CuratorInput {
  const proposals: ProposalItem[] = Array.from({ length: proposalCount }, (_, i) => ({
    title: `Proposal ${i}`,
    direction: `Direction ${i}`,
  }));

  return {
    proposals,
    articleTitle: 'Some Article',
    articleTemplateType: 'general',
    worldContext,
  };
}

// buildMessages/parseOutput are synchronous, LLM-free, and protected — cast to
// exercise them directly rather than driving a full BaseAgent.run() LLM round-trip.
function drive(agent: CuratorAgent, input: CuratorInput, selectedIndex: number) {
  const a = agent as unknown as {
    buildMessages(worldId: string, input: CuratorInput): unknown;
    parseOutput(input: Record<string, unknown>): { selectedIndex: number; rationale: string };
  };
  a.buildMessages(input.worldContext.worldId, input);
  return a.parseOutput({ selectedIndex, rationale: 'because' });
}

describe('CuratorAgent selectedIndex bounds', () => {
  it('accepts the last valid index for the actual proposal count', () => {
    const agent = new CuratorAgent();
    const input = makeInput(5);
    const result = drive(agent, input, 4);
    expect(result.selectedIndex).toBe(4);
  });

  it('rejects an index equal to proposals.length', () => {
    const agent = new CuratorAgent();
    const input = makeInput(5);
    expect(() => drive(agent, input, 5)).toThrow(/out of range/);
  });

  it('rejects index 3 when there are only 2 proposals (previously allowed by the static .max(4) bound)', () => {
    const agent = new CuratorAgent();
    const input = makeInput(2);
    expect(() => drive(agent, input, 3)).toThrow(/out of range/);
  });
});
