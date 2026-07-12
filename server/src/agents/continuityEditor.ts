import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildContinuityEditorSystemPrompt, buildContinuityEditorUserMessage } from '../prompts/continuityEditor.js';
import type { WorldContext } from './director.js';
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

export interface ContinuityEditorOutput {
  approved:       boolean;
  contradictions: Contradiction[];
}

/** No contextPackage — CE checks the draft against Researcher's brief it's already given, not the raw neighborhood tiers. */
export interface ContinuityEditorInput {
  worldContext:  WorldContext;
  articleTitle:  string;
  draft:         string;
  researchBrief: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ContinuityEditorAgent extends BaseAgent<ContinuityEditorInput, ContinuityEditorOutput> {
  readonly agentType = 'continuity_editor';
  readonly mode = 'write';
  readonly outputToolName = 'submit_continuity_check';

  protected getMaxTokens(): number { return 1000; }

  /**
   * No context tools (v8) — CE checks a draft against the ContextPackage +
   * Researcher's brief it's already given; independently re-querying the
   * world would let it second-guess what Researcher already vetted.
   */
  protected getContextTools(): Tool[] {
    return [];
  }

  protected buildMessages(_worldId: string, input: ContinuityEditorInput): ChatMessage[] {
    return [
      { role: 'system', content: buildContinuityEditorSystemPrompt(input.worldContext) },
      {
        role: 'user',
        content: buildContinuityEditorUserMessage(
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

  protected parseOutput(input: Record<string, unknown>): ContinuityEditorOutput {
    const parsed = SubmitContinuityCheckSchema.parse(input);
    return {
      approved:       parsed.approved,
      contradictions: parsed.contradictions,
    };
  }
}
