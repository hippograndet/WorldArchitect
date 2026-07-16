import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildResearcherSystemPrompt, buildResearcherUserMessage } from '../prompts/researcher.js';
import type { ContextPackage, WorldInfoContext } from '../services/archivist.js';
import { CONTEXT_TOOLS, LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';
import type { ResearchBrief } from './scribe.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitResearchBriefSchema = z.object({
  brief: z.string().min(100).max(1200),
});

export type ResearcherOutput = ResearchBrief;

export interface ResearcherInput {
  contextPackage: ContextPackage;
  worldInfoContext: WorldInfoContext;
  userSpec?: string;
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
      { role: 'system', content: buildResearcherSystemPrompt(input.worldInfoContext) },
      { role: 'user',   content: buildResearcherUserMessage(input.contextPackage, input.userSpec) },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_research_brief;
  }

  protected parseOutput(input: Record<string, unknown>): ResearcherOutput {
    return SubmitResearchBriefSchema.parse(input).brief;
  }
}
