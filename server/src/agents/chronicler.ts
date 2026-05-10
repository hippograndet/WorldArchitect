import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildChroniclerSystemPrompt, buildChroniclerUserMessage } from '../prompts/chronicler.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import { CONTEXT_TOOLS, LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitChronologySchema = z.object({
  chronologySection: z.string(),
});

export type ChroniclerOutput = { chronologySection: string };

export interface ChroniclerInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ChroniclerAgent extends BaseAgent<ChroniclerInput, ChroniclerOutput> {
  readonly agentType = 'chronicler';
  readonly outputToolName = 'submit_chronology';

  protected buildMessages(_worldId: string, input: ChroniclerInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildChroniclerSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildChroniclerUserMessage(input.contextPackage, input.userSpec),
      },
    ];
  }

  protected getContextTools(): Tool[] {
    return [...CONTEXT_TOOLS, LOOKUP_NAMES_TOOL];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_chronology;
  }

  protected parseOutput(input: Record<string, unknown>): ChroniclerOutput {
    const parsed = SubmitChronologySchema.parse(input);
    return { chronologySection: parsed.chronologySection };
  }
}
