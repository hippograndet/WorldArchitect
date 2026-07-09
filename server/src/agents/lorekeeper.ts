import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildSummarizerSystemPrompt,
  buildSummarizerUserMessage,
  type SummarizerPromptMode,
} from '../prompts/summarizer.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ChatMessage, CompletionOptions } from '../providers/types.js';
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
  contextPackage: ContextPackage;
  mode?: LorekeepMode;
  existingIntro?: string;
  revisionNotes?: string;
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
          input.description,
          input.contextPackage,
          promptMode,
          input.existingIntro,
          input.revisionNotes,
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
