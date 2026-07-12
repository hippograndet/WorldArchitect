import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildGroundingCheckSystemPrompt, buildGroundingCheckUserMessage } from '../prompts/groundingCheck.js';
import type { WorldContext } from './director.js';
import type { Contradiction } from './continuityEditor.js';
import type { ResearchBrief } from './scribe.js';
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

/** No contextPackage — checks the draft against Researcher's brief, not the raw neighborhood tiers. */
export interface GroundingCheckInput {
  worldContext:   WorldContext;
  articleTitle:   string;
  draft:          string;
  researchBrief?: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Inception-stage critic: checks Lorekeeper's introduction against
 * Researcher's brief for contradictions, before the introduction is
 * committed to the World Bible. Runs once, with at most one revision
 * attempt afterward — it does not re-verify the revision; deeper checking
 * happens in Consolidate (Linter, Warden).
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
      { role: 'user', content: buildGroundingCheckUserMessage(input.articleTitle, input.draft, input.researchBrief) },
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
