import { describe, expect, it } from 'vitest';
import { CuratorAgent, type CuratorInput } from './curator.js';
import type { IdeaItem } from './muse.js';
import type { WorldContext } from './director.js';

const worldContext: WorldContext = {
  worldId: 'world-1',
  name: 'Test World',
  tone: 'neutral',
  originPoint: null,
  styleConfig: null,
};

function makeInput(ideaCount: number): CuratorInput {
  const ideas: IdeaItem[] = Array.from({ length: ideaCount }, (_, i) => ({
    id: `idea-${i}`,
    theme: `Theme ${i}`,
    detail: `Detail ${i}`,
  }));

  return {
    ideas,
    articleTitle: 'Some Article',
    articleTemplateType: 'general',
    worldContext,
  };
}

// buildMessages/parseOutput are synchronous, LLM-free, and protected — cast to
// exercise them directly rather than driving a full BaseAgent.run() LLM round-trip.
function drive(agent: CuratorAgent, input: CuratorInput, selectedIndices: number[]) {
  const a = agent as unknown as {
    buildMessages(worldId: string, input: CuratorInput): unknown;
    parseOutput(input: Record<string, unknown>): { selectedIndices: number[]; rationale: string };
  };
  a.buildMessages(input.worldContext.worldId, input);
  return a.parseOutput({ selectedIndices, rationale: 'because' });
}

describe('CuratorAgent selectedIndices bounds', () => {
  it('accepts the last valid index for the actual idea count', () => {
    const agent = new CuratorAgent();
    const input = makeInput(5);
    const result = drive(agent, input, [4]);
    expect(result.selectedIndices).toEqual([4]);
  });

  it('rejects an index equal to ideas.length', () => {
    const agent = new CuratorAgent();
    const input = makeInput(5);
    expect(() => drive(agent, input, [5])).toThrow(/out of range/);
  });

  it('rejects index 3 when there are only 2 ideas', () => {
    const agent = new CuratorAgent();
    const input = makeInput(2);
    expect(() => drive(agent, input, [3])).toThrow(/out of range/);
  });
});
