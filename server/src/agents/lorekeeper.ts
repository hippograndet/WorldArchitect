import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildSummarizerSystemPrompt,
  buildSummarizerUserMessage,
  type SummarizerPromptMode,
} from '../prompts/summarizer.js';
import type { WorldContext } from './director.js';
import type { ChatMessage, CompletionOptions } from '../providers/types.js';
import type { Tool } from '../tools/types.js';
import type { ResearchBrief } from './scribe.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitIntroductionSchema = z.object({
  introduction: z.string().min(1),
});

export type LorekeepOutput = { introduction: string };
export type LorekeepMode = 'full' | 'improve';

/**
 * No `description` field — distilling a Description into an intro is not
 * Lorekeeper's job structurally (see nodes.ts's lorekeeperSummarizeAfterExpandNode,
 * which uses Scribe's own childDescription output directly instead of routing
 * it through Lorekeeper). No `contextPackage` either — Lorekeeper writes from
 * researchBrief + worldContext + (optionally) its own prior introduction, not
 * from the raw neighborhood tiers Researcher already distilled.
 */
export interface LorekeepInput {
  articleTitle: string;
  worldContext: WorldContext;
  mode?: LorekeepMode;
  existingIntro?: string;
  revisionNotes?: string;
  researchBrief?: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class LorekeepAgent extends BaseAgent<LorekeepInput, LorekeepOutput> {
  readonly agentType = 'lorekeeper';
  readonly mode = 'write';
  readonly outputToolName = 'submit_introduction';

  protected getMaxTokens(): number { return 700; }

  protected getMaxIterations(): number { return 3; }

  protected getCompletionOptions(): CompletionOptions {
    return { timeoutMs: 120_000 };
  }

  protected buildMessages(_worldId: string, input: LorekeepInput): ChatMessage[] {
    const promptMode: SummarizerPromptMode = input.mode === 'improve' ? 'improve' : 'full';
    return [
      {
        role: 'system',
        content: buildSummarizerSystemPrompt(input.worldContext, promptMode),
      },
      {
        role: 'user',
        content: buildSummarizerUserMessage(
          input.articleTitle,
          promptMode,
          input.existingIntro,
          input.revisionNotes,
          input.researchBrief,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_introduction;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): LorekeepOutput {
    const parsed = SubmitIntroductionSchema.parse(input);
    return { introduction: parsed.introduction };
  }
}
