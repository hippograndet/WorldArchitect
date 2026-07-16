import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildArbiterSystemPrompt, buildArbiterUserMessage } from '../prompts/arbiter.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { ResearchBrief } from './scribe.js';
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

const SubmitContinuityCheckSchema = z.object({
  approved:       z.boolean(),
  contradictions: z.array(ContradictionSchema).default([]),
});

export interface Contradiction {
  excerpt:    string;
  issue:      string;
  correction: string;
}

export interface ArbiterOutput {
  approved:       boolean;
  contradictions: Contradiction[];
}

/** No contextPackage — Arbiter checks the draft against Researcher's brief it's already given, not the raw neighborhood tiers. */
export interface ArbiterInput {
  worldInfoContext: WorldInfoContext;
  articleTitle:  string;
  draft:         string;
  researchBrief: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ArbiterAgent extends BaseAgent<ArbiterInput, ArbiterOutput> {
  readonly agentType = 'continuity_editor';
  readonly mode = 'write';
  readonly outputToolName = 'submit_continuity_check';

  protected getMaxTokens(): number { return 1000; }

  /**
   * No context tools (v8) — Arbiter checks a draft against the ContextPackage +
   * Researcher's brief it's already given; independently re-querying the
   * world would let it second-guess what Researcher already vetted.
   */
  protected getContextTools(): Tool[] {
    return [];
  }

  protected buildMessages(_worldId: string, input: ArbiterInput): ChatMessage[] {
    return [
      { role: 'system', content: buildArbiterSystemPrompt(input.worldInfoContext) },
      {
        role: 'user',
        content: buildArbiterUserMessage(
          input.articleTitle,
          input.draft,
          input.researchBrief,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_continuity_check;
  }

  protected parseOutput(input: Record<string, unknown>): ArbiterOutput {
    const parsed = SubmitContinuityCheckSchema.parse(input);
    return {
      approved:       parsed.approved,
      contradictions: parsed.contradictions,
    };
  }
}
