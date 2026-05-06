import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildSummarizerSystemPrompt,
  buildSummarizerUserMessage,
  type SummarizerPromptMode,
} from '../prompts/summarizer.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitIntroductionSchema = z.object({
  introduction: z.string().min(1),
});

export type LorekeepOutput = { introduction: string };
export type LorekeepMode = 'full' | 'improve';

export interface LorekeepInput {
  articleTitle: string;
  description: string;
  worldContext: WorldContext;
  mode?: LorekeepMode;
  existingIntro?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class LorekeepAgent extends BaseAgent<LorekeepInput, LorekeepOutput> {
  readonly agentType = 'lorekeeper';
  readonly outputToolName = 'submit_introduction';

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
          input.description,
          promptMode,
          input.existingIntro,
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
