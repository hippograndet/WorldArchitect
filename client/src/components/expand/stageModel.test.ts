import { describe, it, expect } from 'vitest';
import { buildAgentStages } from './stageModel.ts';
import type { RunAgentCall, RunWithEvents } from '../../types/run.ts';

function makeCall(overrides: Partial<RunAgentCall>): RunAgentCall {
  return {
    id: `call-${Math.random()}`,
    articleId: 'article-1',
    agentType: 'lorekeeper',
    status: 'success',
    errorMessage: null,
    iterations: 1,
    tokensIn: 10,
    tokensOut: 10,
    pipelineType: 'summarize',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunWithEvents>): RunWithEvents {
  return {
    id: 'run-1',
    worldId: 'world-1',
    ownerId: 'owner-1',
    status: 'completed',
    graphType: 'expand',
    checkpointId: 'checkpoint-1',
    articleIds: ['article-1'],
    budgetUsed: 0,
    budgetLimit: 0,
    config: { startStep: 'inception', forgeContinuationMode: 'one_step' },
    errorMessage: null,
    itemsCompleted: 1,
    itemsTotal: 1,
    itemsFailed: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    agentCalls: [],
    reviewItems: [],
    queueItems: [],
    ...overrides,
  };
}

describe('buildAgentStages', () => {
  it('never emits a context_assembly stage', () => {
    const run = makeRun({ config: { startStep: 'inception', forgeContinuationMode: 'recursive' } });
    const stages = buildAgentStages(run, 'article-1');
    expect(stages.some((stage) => stage.agentType === 'context_assembly')).toBe(false);
    // Research always runs first, and its only stage is now the researcher itself.
    expect(stages[0].agentType).toBe('researcher');
  });

  it('reports checker retry counts against the configured max', () => {
    const run = makeRun({
      config: { startStep: 'expansion', forgeContinuationMode: 'one_step', coherenceCheckLevel: 2 },
      agentCalls: [
        makeCall({ agentType: 'scribe', status: 'success' }),
        makeCall({ agentType: 'continuity_editor', status: 'success' }),
        makeCall({ agentType: 'scribe', status: 'success' }),
        makeCall({ agentType: 'continuity_editor', status: 'success' }),
      ],
    });
    const stages = buildAgentStages(run, 'article-1');
    const arbiter = stages.find((stage) => stage.agentType === 'continuity_editor');
    expect(arbiter?.retryGeneratorAgentType).toBe('scribe');
    expect(arbiter?.retryMax).toBe(2);
    expect(arbiter?.retryActual).toBe(1);
  });

  it('attributes a failed research-step event to the researcher stage, not a context stage', () => {
    const run = makeRun({
      config: { startStep: 'inception', forgeContinuationMode: 'one_step' },
      events: [{ id: 'ev-1', step: 'Research', title: 'article-1', ok: false, message: 'boom', createdAt: Date.now() }],
    });
    const stages = buildAgentStages(run, 'article-1');
    const researcher = stages.find((stage) => stage.step === 'research');
    expect(researcher?.agentType).toBe('researcher');
    expect(researcher?.status).toBe('failed');
  });
});
