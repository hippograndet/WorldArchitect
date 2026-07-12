import { z } from 'zod';
import { ArchitectAgent } from './architect.js';
import { MuseAgent } from './muse.js';
import { CuratorAgent } from './curator.js';
import { ResearcherAgent } from './researcher.js';
import { ScribeAgent } from './scribe.js';
import { ContinuityEditorAgent } from './continuityEditor.js';
import { LorekeepAgent } from './lorekeeper.js';
import { GroundingCheckAgent } from './groundingCheck.js';
import { CartographerAgent } from './cartographer.js';
import { DedupCheckAgent } from './dedupCheck.js';
import { MentionExtractorAgent } from './mentionExtractor.js';
import { WardenAgent } from './warden.js';
import { SentinelAgent } from './sentinel.js';
import { StyleWardenAgent } from './styleWarden.js';
import { LinterAgent } from './linter.js';
import { FixerAgent } from './fixer.js';
import { AuditorAgent } from './auditor.js';
import { CondenserAgent } from './condenser.js';
import { StylistAgent } from './stylist.js';
import type { BaseAgent } from './base.js';

export type ToolCategory = 'none' | 'lookup' | 'narrow' | 'full';
type AnyAgent = BaseAgent<any, any>;

export interface AgentCostProfile {
  agentType: string;
  tools: string[];
  toolCategory: ToolCategory;
  maxIterations: number;
  outputMode: 'tool' | 'text';
  maxTokens: number;
  callRange: { min: number; max: number };
  note: string;
}

export interface PipelineTemplateStep {
  agentType: string;
  min: number;
  max: number;
  optional?: boolean;
}

export interface PipelineTemplate {
  pipeline: string;
  steps: PipelineTemplateStep[];
  notes: string[];
}

export interface RunEstimateRequest {
  articleId?: string;
  startStep: 'inception' | 'expansion' | 'branching';
  continuationMode: 'one_step' | 'finish_document' | 'recursive';
  validationLevel: 'manual' | 'assisted' | 'autopilot';
  maxDepth?: number;
  maxChildren?: number;
  contextDepth?: 'shallow' | 'mid' | 'deep';
  /** One global dial covering Continuity Editor, Grounding Check, and Dedup Check. */
  coherenceCheckLevel?: number;
  safetyNet?: boolean;
  runStyleWarden?: boolean;
}

export interface RunEstimateResponse {
  documents: number;
  queueItems: number;
  calls: { min: number; max: number };
  byAgent: Array<{ agentType: string; min: number; max: number }>;
  estimatedTokens?: number;
  notes: string[];
}

export const RunEstimateRequestSchema = z.object({
  articleId: z.string().min(1).optional(),
  startStep: z.enum(['inception', 'expansion', 'branching']).default('expansion'),
  continuationMode: z.enum(['one_step', 'finish_document', 'recursive']).default('finish_document'),
  validationLevel: z.enum(['manual', 'assisted', 'autopilot']).default('autopilot'),
  maxDepth: z.number().int().min(0).max(8).optional(),
  maxChildren: z.number().int().min(0).max(50).optional(),
  contextDepth: z.enum(['shallow', 'mid', 'deep']).default('mid'),
  coherenceCheckLevel: z.number().int().min(0).max(3).optional(),
  safetyNet: z.boolean().optional(),
  runStyleWarden: z.boolean().optional(),
});

function allAgentInstances(): AnyAgent[] {
  return [
    new ArchitectAgent(),
    new MuseAgent(),
    new CuratorAgent(),
    new ResearcherAgent(),
    new ScribeAgent(),
    new ContinuityEditorAgent(),
    new LorekeepAgent(),
    new GroundingCheckAgent(),
    new CartographerAgent(),
    new DedupCheckAgent(),
    new MentionExtractorAgent(),
    new WardenAgent(),
    new SentinelAgent(),
    new StyleWardenAgent(),
    new LinterAgent(),
    new FixerAgent(),
    new AuditorAgent(),
    new CondenserAgent(),
    new StylistAgent(),
  ] as AnyAgent[];
}

function categorizeTools(tools: string[]): ToolCategory {
  if (tools.length === 0) return 'none';
  if (tools.length === 1 && tools[0] === 'lookup_names') return 'lookup';
  const fullContextTools = ['get_world_bible', 'get_article', 'search_articles', 'get_article_links'];
  if (fullContextTools.every((name) => tools.includes(name))) return 'full';
  return 'narrow';
}

function noteFor(category: ToolCategory, tools: string[], outputMode: 'tool' | 'text'): string {
  const toolNote = category === 'none'
    ? 'no context tools'
    : category === 'lookup'
      ? 'lookup_names only'
      : category === 'full'
        ? tools.includes('lookup_names') ? 'full context-tool set + lookup_names' : 'full context-tool set'
        : tools.join(' + ');
  return outputMode === 'text' ? `${toolNote}; prose text output` : toolNote;
}

function expectedTurnRange(category: ToolCategory, maxIterations: number): { min: number; max: number } {
  const max = category === 'none'
    ? 1
    : category === 'lookup'
      ? Math.min(2, maxIterations)
      : category === 'narrow'
        ? Math.min(3, maxIterations)
        : maxIterations;
  return { min: 1, max: Math.max(1, max) };
}

export function getAgentCostProfiles(): AgentCostProfile[] {
  return allAgentInstances()
    .map((agent) => {
      const runtime = agent.describeCostProfile();
      const tools = [...runtime.tools].sort();
      const toolCategory = categorizeTools(tools);
      return {
        ...runtime,
        tools,
        toolCategory,
        callRange: expectedTurnRange(toolCategory, runtime.maxIterations),
        note: noteFor(toolCategory, tools, runtime.outputMode),
      };
    })
    .sort((a, b) => a.agentType.localeCompare(b.agentType));
}

function addAgent(map: Map<string, { agentType: string; min: number; max: number }>, agentType: string, min = 1, max = min): void {
  const current = map.get(agentType) ?? { agentType, min: 0, max: 0 };
  current.min += min;
  current.max += max;
  map.set(agentType, current);
}

function mergeInto(target: Map<string, { agentType: string; min: number; max: number }>, source: Map<string, { agentType: string; min: number; max: number }>, multiplier = 1): void {
  for (const item of source.values()) addAgent(target, item.agentType, item.min * multiplier, item.max * multiplier);
}

function estimateRecursiveScope(maxChildren: number, maxDepth: number): number {
  const branchFactor = maxChildren > 0 ? maxChildren : 5;
  let total = 1;
  for (let depth = 1; depth <= maxDepth; depth += 1) total += Math.pow(branchFactor, depth);
  return total;
}

function selectedSteps(startStep: RunEstimateRequest['startStep'], continuationMode: RunEstimateRequest['continuationMode']): RunEstimateRequest['startStep'][] {
  const order: RunEstimateRequest['startStep'][] = ['inception', 'expansion', 'branching'];
  return continuationMode === 'one_step' ? [startStep] : order.slice(order.indexOf(startStep));
}

/** Max checker calls for a level-N, at-most-one-safety-net-pass loop: N checks + N revisions + (safetyNet ? 1 : 0) final check. */
function maxCheckerCalls(level: number, safetyNet?: boolean): number {
  return level * 2 + (safetyNet ? 1 : 0);
}

function estimateInception(input: RunEstimateRequest): Map<string, { agentType: string; min: number; max: number }> {
  const out = new Map<string, { agentType: string; min: number; max: number }>();
  addAgent(out, 'lorekeeper');
  const level = input.coherenceCheckLevel ?? 0;
  if (level > 0) {
    addAgent(out, 'grounding_check', 1, maxCheckerCalls(level, input.safetyNet));
    addAgent(out, 'lorekeeper', 0, level);
  }
  return out;
}

function estimateExpansion(input: RunEstimateRequest): Map<string, { agentType: string; min: number; max: number }> {
  const out = new Map<string, { agentType: string; min: number; max: number }>();
  addAgent(out, 'researcher');
  addAgent(out, 'muse');
  if (input.validationLevel !== 'manual') addAgent(out, 'curator');
  addAgent(out, 'scribe');
  const level = input.coherenceCheckLevel ?? 0;
  if (level > 0) {
    addAgent(out, 'continuity_editor', 1, maxCheckerCalls(level, input.safetyNet));
    addAgent(out, 'scribe', 0, level);
  }
  if (input.runStyleWarden) addAgent(out, 'style_warden');
  return out;
}

function estimateBranching(input: RunEstimateRequest): Map<string, { agentType: string; min: number; max: number }> {
  const out = new Map<string, { agentType: string; min: number; max: number }>();
  addAgent(out, 'cartographer');
  const level = input.coherenceCheckLevel ?? 0;
  if (level > 0) {
    addAgent(out, 'dedup_check', 1, maxCheckerCalls(level, input.safetyNet));
    addAgent(out, 'cartographer', 0, level);
  }
  return out;
}

function estimateStandalone(pipeline: string): Map<string, { agentType: string; min: number; max: number }> {
  const out = new Map<string, { agentType: string; min: number; max: number }>();
  if (pipeline === 'reorganize') {
    addAgent(out, 'scribe');
    addAgent(out, 'sentinel');
    addAgent(out, 'lorekeeper');
  } else if (pipeline === 'cohere') addAgent(out, 'warden');
  else if (pipeline === 'audit') addAgent(out, 'auditor');
  else if (pipeline === 'compress') addAgent(out, 'condenser');
  return out;
}

function coarseTokenEstimate(calls: number, contextDepth: RunEstimateRequest['contextDepth']): number {
  const perCall = contextDepth === 'deep' ? 1600 : contextDepth === 'mid' ? 1100 : 700;
  return Math.max(1, Math.round(calls * perCall));
}

export function estimateRun(input: RunEstimateRequest): RunEstimateResponse {
  const docs = input.continuationMode === 'recursive'
    ? estimateRecursiveScope(input.maxChildren ?? 5, input.maxDepth ?? 1)
    : 1;
  const perDoc = new Map<string, { agentType: string; min: number; max: number }>();
  for (const step of selectedSteps(input.startStep, input.continuationMode)) {
    const stepEstimate = step === 'inception'
      ? estimateInception(input)
      : step === 'expansion'
        ? estimateExpansion(input)
        : estimateBranching(input);
    mergeInto(perDoc, stepEstimate);
  }

  const byAgent = new Map<string, { agentType: string; min: number; max: number }>();
  mergeInto(byAgent, perDoc, docs);
  const rows = [...byAgent.values()].sort((a, b) => a.agentType.localeCompare(b.agentType));
  const min = rows.reduce((sum, item) => sum + item.min, 0);
  const max = rows.reduce((sum, item) => sum + item.max, 0);
  const notes = [
    'Structural estimate only; no LLM calls, graph execution, context tools, drafts, or run rows are created.',
    'Call ranges count agent.run invocations, not provider billing or cached-token effects.',
  ];
  if ((input.coherenceCheckLevel ?? 0) > 0) notes.push('Coherence checks can add up to coherenceCheckLevel check→revise cycles, plus one final safety-net check.');
  if (input.continuationMode === 'recursive') notes.push('Recursive document count assumes every generated child slot is filled.');
  return {
    documents: docs,
    queueItems: docs,
    calls: { min, max },
    byAgent: rows,
    estimatedTokens: coarseTokenEstimate(max, input.contextDepth ?? 'mid'),
    notes,
  };
}

export function getPipelineTemplates(): PipelineTemplate[] {
  return [
    { pipeline: 'inception', steps: [{ agentType: 'lorekeeper', min: 1, max: 2 }, { agentType: 'grounding_check', min: 0, max: 3, optional: true }], notes: ['Grounding Check runs up to coherenceCheckLevel check→revise cycles.'] },
    { pipeline: 'expansion', steps: [{ agentType: 'researcher', min: 1, max: 1 }, { agentType: 'muse', min: 1, max: 1 }, { agentType: 'curator', min: 0, max: 1, optional: true }, { agentType: 'scribe', min: 1, max: 2 }, { agentType: 'continuity_editor', min: 0, max: 3, optional: true }, { agentType: 'style_warden', min: 0, max: 1, optional: true }], notes: ['Muse now produces the idea list directly (no separate direction-then-ideas stage); Continuity Editor runs up to coherenceCheckLevel check→revise cycles.'] },
    { pipeline: 'branching', steps: [{ agentType: 'cartographer', min: 1, max: 1 }, { agentType: 'dedup_check', min: 0, max: 3, optional: true }], notes: ['Dedup Check runs up to coherenceCheckLevel check→revise cycles.'] },
    { pipeline: 'reorganize', steps: [...estimateStandalone('reorganize').values()], notes: [] },
    { pipeline: 'cohere', steps: [...estimateStandalone('cohere').values()], notes: ['Sparse worlds can skip the Warden call at runtime.'] },
    { pipeline: 'audit', steps: [...estimateStandalone('audit').values()], notes: [] },
    { pipeline: 'compress', steps: [...estimateStandalone('compress').values()], notes: [] },
  ];
}
