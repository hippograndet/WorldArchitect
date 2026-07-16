import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionResult } from '../../../providers/types.js';
import type { ContextPackage } from '../../../services/archivist.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());

vi.mock('../../../providers/index.js', () => ({
  getProvider: async () => ({ name: 'anthropic', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('../../../services/callLogger.js', () => ({
  logCall: vi.fn(),
}));

// Import after the mocks above are registered.
const { runExpandGraph } = await import('./expand.js');

function toolUseResult(name: string, input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'tool_use',
    toolCalls: [{ id: `call-${name}`, name, input }],
  };
}

const contextPackage: ContextPackage = {
  targetId: 'child-article',
  targetTitle: 'Child Article',
  targetTemplateType: 'general',
  targetDescription: '',
  targetChronology: '',
  targetIntroduction: '',
  parents: [],
  siblings: [],
  children: [],
  fixedPoints: [],
  temporalNeighbors: [],
  referencedArticles: [],
  estimatedTokens: 10,
};

const worldContext = { worldId: 'w1', name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };
const worldInfoContext = { worldId: 'w1', title: 'Test World', introduction: 'A test world.' };

beforeEach(() => {
  completeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runExpandGraph create_child + Stylizer ordering (Task 2.5 fix)', () => {
  it('the final introduction matches Stylizer\'s rewritten description, not Scribe\'s pre-rewrite draft', async () => {
    completeMock
      .mockResolvedValueOnce(toolUseResult('submit_child_description', {
        childDescription: 'A plain pre-rewrite draft describing the child entity.',
        parentAppend: 'A new child was added.',
      }))
      .mockResolvedValueOnce(toolUseResult('submit_style_check', {
        description: 'A restyled draft matching the world\'s established voice.',
        changesSummary: 'Adjusted phrasing to match Writing Style.',
      }));

    const result = await runExpandGraph({
      worldId: 'w1',
      ownerId: 'owner-1',
      articleId: 'child-article',
      pipelineType: 'create_child',
      runStylizer: true,
      worldContext,
      worldInfoContext,
      contextPackage,
      researchBrief: 'An established fact the child article must respect.',
    });

    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(result.description).toBe('A restyled draft matching the world\'s established voice.');
    expect(result.introduction).toBe('A restyled draft matching the world\'s established voice.');
    expect(result.introduction).not.toBe('A plain pre-rewrite draft describing the child entity.');
  });
});
