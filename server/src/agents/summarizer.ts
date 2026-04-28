import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildSummarizerSystemPrompt, buildSummarizerUserMessage } from '../prompts/summarizer.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitIntroductionSchema = z.object({
  introduction: z.string().min(1),
});

export type SummarizerOutput = { introduction: string };

export interface SummarizerInput {
  articleTitle: string;
  description: string;
  worldContext: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class SummarizerAgent extends BaseAgent<SummarizerInput, SummarizerOutput> {
  readonly agentType = 'summarizer';
  readonly outputToolName = 'submit_introduction';

  protected buildMessages(_worldId: string, input: SummarizerInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildSummarizerSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildSummarizerUserMessage(input.articleTitle, input.description),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_introduction;
  }

  // No DB context needed — works solely from the provided description
  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): SummarizerOutput {
    const parsed = SubmitIntroductionSchema.parse(input);
    return { introduction: parsed.introduction };
  }
}
