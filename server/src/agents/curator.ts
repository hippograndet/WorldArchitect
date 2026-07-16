import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildTasteSystemPrompt, buildTasteUserMessage } from '../prompts/taste.js';
import type { WorldContext } from './director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { IdeaItem } from './muse.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitCuratorSchema = z.object({
  selectedIndices: z.array(z.number().int().min(0)).min(1),
  rationale: z.string().min(1),
});

export type CuratorOutput = { selectedIndices: number[]; rationale: string };

/** The one place user preference enters the Expand pipeline — Muse itself is grounding-only, no userSpec. */
export interface CuratorInput {
  ideas: IdeaItem[];
  articleTitle: string;
  articleTemplateType: string;
  currentSummary?: string;
  worldInfoContext: WorldInfoContext;
  worldContext: WorldContext;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CuratorAgent extends BaseAgent<CuratorInput, CuratorOutput> {
  readonly agentType = 'curator';
  readonly mode = 'check';
  readonly outputToolName = 'submit_taste_selection';

  private _ideaCount: number | null = null;

  protected buildMessages(_worldId: string, input: CuratorInput): ChatMessage[] {
    this._ideaCount = input.ideas.length;
    return [
      {
        role: 'system',
        content: buildTasteSystemPrompt(input.worldInfoContext, input.worldContext),
      },
      {
        role: 'user',
        content: buildTasteUserMessage(
          input.articleTitle,
          input.articleTemplateType,
          input.ideas,
          input.currentSummary,
          input.userSpec,
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
    const count = this._ideaCount ?? 0;
    const outOfRange = parsed.selectedIndices.find((i) => i >= count);
    if (outOfRange !== undefined) {
      throw new Error(`selectedIndices contains ${outOfRange}, which is out of range — there are only ${count} ideas (valid range: 0-${count - 1}).`);
    }
    return { selectedIndices: parsed.selectedIndices, rationale: parsed.rationale };
  }
}
