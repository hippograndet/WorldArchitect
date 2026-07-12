import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(byAgent.get('grounding_check')).toMatchObject({
      tools: ['get_article', 'search_articles'],
      toolCategory: 'narrow',
    });
    expect(byAgent.get('researcher')?.toolCategory).toBe('full');
    expect(byAgent.get('lorekeeper')?.maxIterations).toBe(3);
    expect(byAgent.get('mention_extractor')?.maxIterations).toBe(2);
  });

  it('keeps every registered agent visible in the MAS reference roster', () => {
    const ref = readFileSync(resolve(process.cwd(), '../dev-docs/mas_reference.md'), 'utf8');
    for (const profile of getAgentCostProfiles()) {
      expect(ref, `${profile.agentType} missing from mas_reference.md`).toContain(`| \`${profile.agentType}\` |`);
    }
  });

  it('exposes pipeline templates for the supported dry-run surfaces', () => {
    expect(getPipelineTemplates().map((template) => template.pipeline).sort()).toEqual([
      'audit',
      'branching',
      'cohere',
      'compress',
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
      runOracle: true,
      runContinuityEditor: true,
      runStyleWarden: true,
    }));

    expect(estimate.documents).toBe(1);
    expect(estimate.calls).toEqual({ min: 7, max: 9 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'researcher', min: 1, max: 1 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'curator', min: 1, max: 1 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'oracle', min: 1, max: 1 });
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
      runOracle: true,
      runContinuityEditor: true,
      runGroundingCheck: true,
      runDedupCheck: true,
    }));

    expect(estimate.documents).toBe(7);
    expect(estimate.queueItems).toBe(7);
    expect(estimate.byAgent).toContainEqual({ agentType: 'lorekeeper', min: 7, max: 14 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'grounding_check', min: 7, max: 14 });
    expect(estimate.byAgent).toContainEqual({ agentType: 'dedup_check', min: 7, max: 7 });
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
