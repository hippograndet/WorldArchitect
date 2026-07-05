import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildResearcherSystemPrompt, buildResearcherUserMessage } from '../prompts/researcher.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import { CONTEXT_TOOLS, LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';
import type { ResearchBrief } from './scribe.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitResearchBriefSchema = z.object({
  keyFacts:        z.array(z.string()).min(1).max(10),
  warnings:        z.array(z.string()).max(3).default([]),
  suggestedAngles: z.array(z.string()).min(1).max(3),
});

export type ResearcherOutput = ResearchBrief;

export interface ResearcherInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ResearcherAgent extends BaseAgent<ResearcherInput, ResearcherOutput> {
  readonly agentType = 'researcher';
  readonly mode = 'write';
  readonly outputToolName = 'submit_research_brief';

  protected getMaxTokens(): number { return 800; }

  protected getContextTools(): Tool[] {
    return [...CONTEXT_TOOLS, LOOKUP_NAMES_TOOL];
  }

  protected buildMessages(_worldId: string, input: ResearcherInput): ChatMessage[] {
    return [
      { role: 'system', content: buildResearcherSystemPrompt(input.worldContext) },
      { role: 'user',   content: buildResearcherUserMessage(input.contextPackage) },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_research_brief;
  }

  protected parseOutput(input: Record<string, unknown>): ResearcherOutput {
    const parsed = SubmitResearchBriefSchema.parse(input);
    return {
      keyFacts:        parsed.keyFacts,
      warnings:        parsed.warnings,
      suggestedAngles: parsed.suggestedAngles,
    };
  }
}
