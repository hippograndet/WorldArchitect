import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildTasteSystemPrompt, buildTasteUserMessage } from '../prompts/taste.js';
import type { WorldContext } from './director.js';
import type { ProposalItem } from './muse.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitCuratorSchema = z.object({
  selectedIndex: z.number().int().min(0).max(4),
  rationale: z.string().min(1),
});

export type CuratorOutput = { selectedIndex: number; rationale: string };

export interface CuratorInput {
  proposals: ProposalItem[];
  articleTitle: string;
  articleTemplateType: string;
  currentSummary?: string;
  worldContext: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CuratorAgent extends BaseAgent<CuratorInput, CuratorOutput> {
  readonly agentType = 'curator';
  readonly outputToolName = 'submit_taste_selection';

  protected buildMessages(_worldId: string, input: CuratorInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildTasteSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildTasteUserMessage(
          input.articleTitle,
          input.articleTemplateType,
          input.proposals,
          input.currentSummary,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_taste_selection;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): CuratorOutput {
    const parsed = SubmitCuratorSchema.parse(input);
    return { selectedIndex: parsed.selectedIndex, rationale: parsed.rationale };
  }
}
