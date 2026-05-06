import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildPromptEngineerSystemPrompt,
  buildPromptEngineerUserMessage,
  type PromptEngineerFieldType,
} from '../prompts/promptEngineer.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitExpansionSchema = z.object({
  expandedDescription: z.string().min(1),
});

export type StylistOutput = { expandedDescription: string };

export interface StylistInput {
  fieldType: PromptEngineerFieldType;
  rawText: string;
  worldName: string;
  worldDescription: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class StylistAgent extends BaseAgent<StylistInput, StylistOutput> {
  readonly agentType = 'stylist';
  readonly outputToolName = 'submit_prompt_expansion';

  protected buildMessages(_worldId: string, input: StylistInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildPromptEngineerSystemPrompt(),
      },
      {
        role: 'user',
        content: buildPromptEngineerUserMessage(
          input.fieldType,
          input.rawText,
          input.worldName,
          input.worldDescription,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_prompt_expansion;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): StylistOutput {
    const parsed = SubmitExpansionSchema.parse(input);
    return { expandedDescription: parsed.expandedDescription };
  }
}
