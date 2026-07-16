import { describe, expect, it } from 'vitest';
import {
  getAgentCostProfiles,
  getPipelineTemplates,
  estimateRun,
  RunEstimateRequestSchema,
} from './costModel.js';

describe('MAS cost model', () => {
  it('derives agent tool profiles from real agent classes', () => {
    const profiles = getAgentCostProfiles();
    const byAgent = new Map(profiles.map((profile) => [profile.agentType, profile]));

    expect(byAgent.get('curator')).toMatchObject({
      tools: [],
      toolCategory: 'none',
      outputMode: 'tool',
    });
    expect(byAgent.get('scribe')).toMatchObject({
      tools: ['lookup_names'],
      toolCategory: 'lookup',
      outputMode: 'text',
    });
    expect(byAgent.get('cartographer')).toMatchObject({
      tools: ['lookup_names'],
      toolCategory: 'lookup',
    });
    expect(byAgent.get('researcher')?.toolCategory).toBe('full');
    expect(byAgent.get('lorekeeper')?.maxIterations).toBe(3);
    expect(byAgent.get('mention_extractor')?.maxIterations).toBe(2);
  });

  it('exposes pipeline templates for the supported dry-run surfaces', () => {
    expect(getPipelineTemplates().map((template) => template.pipeline).sort()).toEqual([
      'audit',
      'branching',
      'cohere',
      'expansion',
      'inception',
      'reorganize',
    ]);
  });

  it('estimates expansion options without executing agents', () => {
    const estimate = estimateRun(RunEstimateRequestSchema.parse({
      startStep: 'expansion',
      continuationMode: 'one_step',
      validationLevel: 'assisted',
      contextDepth: 'mid',
      coherenceCheckLevel: 1,
      safetyNet: false,
      runStylizer: true,
    }));

    expect(estimate.documents).toBe(1);
    expect(estimate.calls).toEqual({ min: 6, max: 8 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'researcher', min: 1, max: 1 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'curator', min: 1, max: 1 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'muse', min: 1, max: 1 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'scribe', min: 1, max: 2 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'continuity_editor', min: 1, max: 2 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'style_warden', min: 1, max: 1 });
  });

  it('estimates inception, branching, and recursive scope', () => {
    const estimate = estimateRun(RunEstimateRequestSchema.parse({
      startStep: 'inception',
      continuationMode: 'recursive',
      validationLevel: 'autopilot',
      maxChildren: 2,
      maxDepth: 2,
      contextDepth: 'deep',
      coherenceCheckLevel: 1,
      safetyNet: false,
    }));

    expect(estimate.documents).toBe(7);
    expect(estimate.queueItems).toBe(7);
    expect(estimate.byAgent).toContainEqual({ agentType: 'lorekeeper', min: 7, max: 7 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'dedup_check', min: 7, max: 14 });
    expect(estimate.calls.min).toBeGreaterThan(0);
    expect(estimate.calls.max).toBeGreaterThan(estimate.calls.min);
  });

  it('rejects invalid run estimate configs', () => {
    expect(RunEstimateRequestSchema.safeParse({
      startStep: 'bad',
      continuationMode: 'recursive',
      validationLevel: 'autopilot',
    }).success).toBe(false);
  });
});
