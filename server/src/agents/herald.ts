import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildHeraldSystemPrompt,
  buildHeraldUserMessage,
  type HeraldPromptMode,
} from '../prompts/herald.js';
import type { WorldContext } from './director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { ChatMessage, CompletionOptions } from '../providers/types.js';
import type { Tool } from '../tools/types.js';
import type { ResearchBrief } from './scribe.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitIntroductionSchema = z.object({
  introduction: z.string().min(1),
});

export type HeraldOutput = { introduction: string };
export type HeraldMode = 'full' | 'improve';

/**
 * No `description` field — distilling a Description into an intro is not
 * Herald's job structurally (see nodes.ts's deriveIntroFromChildDescriptionNode,
 * which uses Scribe's own childDescription output directly instead of routing
 * it through Herald). No `contextPackage` either — Herald writes from
 * researchBrief + worldContext + (optionally) its own prior introduction, not
 * from the raw neighborhood tiers Researcher already distilled.
 */
export interface HeraldInput {
  articleTitle: string;
  worldInfoContext: WorldInfoContext;
  worldContext: WorldContext;
  mode?: HeraldMode;
  existingIntro?: string;
  revisionNotes?: string;
  researchBrief?: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class HeraldAgent extends BaseAgent<HeraldInput, HeraldOutput> {
  readonly agentType = 'lorekeeper';
  readonly mode = 'write';
  readonly outputToolName = 'submit_introduction';

  protected getMaxTokens(): number { return 700; }

  protected getMaxIterations(): number { return 3; }

  protected getCompletionOptions(): CompletionOptions {
    return { timeoutMs: 120_000 };
  }

  protected buildMessages(_worldId: string, input: HeraldInput): ChatMessage[] {
    const promptMode: HeraldPromptMode = input.mode === 'improve' ? 'improve' : 'full';
    return [
      {
        role: 'system',
        content: buildHeraldSystemPrompt(input.worldInfoContext, input.worldContext, promptMode),
      },
      {
        role: 'user',
        content: buildHeraldUserMessage(
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

  protected parseOutput(input: Record<string, unknown>): HeraldOutput {
    const parsed = SubmitIntroductionSchema.parse(input);
    return { introduction: parsed.introduction };
  }
}
