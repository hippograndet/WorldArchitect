import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildGroundingCheckSystemPrompt, buildGroundingCheckUserMessage } from '../prompts/groundingCheck.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { Contradiction } from './continuityEditor.js';
import { GET_ARTICLE_TOOL, SEARCH_ARTICLES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const ContradictionSchema = z.object({
  excerpt:    z.string(),
  issue:      z.string(),
  correction: z.string(),
});

const SubmitGroundingCheckSchema = z.object({
  approved:       z.boolean(),
  contradictions: z.array(ContradictionSchema).default([]),
});

export type { Contradiction };

export interface GroundingCheckOutput {
  approved:       boolean;
  contradictions: Contradiction[];
}

export interface GroundingCheckInput {
  contextPackage: ContextPackage;
  worldContext:   WorldContext;
  draft:          string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Inception-stage critic: checks Lorekeeper's introduction against parent
 * articles/fixed points for contradictions, before it is committed to the
 * World Bible. Narrower input than ContinuityEditor (no researchBrief) since
 * Inception runs before Researcher, which is Expansion-only.
 */
export class GroundingCheckAgent extends BaseAgent<GroundingCheckInput, GroundingCheckOutput> {
  readonly agentType = 'grounding_check';
  readonly mode = 'check';
  readonly outputToolName = 'submit_grounding_check';

  protected getMaxTokens(): number { return 1000; }

  /** get_article + search_articles (v8) — enough to verify something outside the curated ContextPackage, not the full escape hatch. */
  protected getContextTools(): Tool[] {
    return [GET_ARTICLE_TOOL, SEARCH_ARTICLES_TOOL];
  }

  protected buildMessages(_worldId: string, input: GroundingCheckInput): ChatMessage[] {
    return [
      { role: 'system', content: buildGroundingCheckSystemPrompt(input.worldContext) },
      { role: 'user', content: buildGroundingCheckUserMessage(input.contextPackage, input.draft) },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_grounding_check;
  }

  protected parseOutput(input: Record<string, unknown>): GroundingCheckOutput {
    const parsed = SubmitGroundingCheckSchema.parse(input);
    return {
      approved:       parsed.approved,
      contradictions: parsed.contradictions,
    };
  }
}
