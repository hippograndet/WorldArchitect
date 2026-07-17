import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildStylizerSystemPrompt, buildStylizerUserMessage } from '../prompts/stylizer.js';
import type { WorldContext } from './director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitStyleCheckSchema = z.object({
  description: z.string(),
  changesSummary: z.string().optional(),
});

export type StylizerOutput = z.infer<typeof SubmitStyleCheckSchema>;

export interface StylizerInput {
  articleTitle: string;
  content: string;
  contentLabel: 'Description' | 'Introduction';
  worldInfoContext: WorldInfoContext;
  worldContext: WorldContext;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Rewrites the given content directly to match the world's style (Writing
 * Tone, Vibe & Atmosphere, Writing Style), preserving every fact/claim —
 * not an advisory checker. See stylizerNode (nodes/forge/draft.ts),
 * which writes this output back into state.description.
 */
export class StylizerAgent extends BaseAgent<StylizerInput, StylizerOutput> {
  readonly agentType = 'style_warden';
  readonly mode = 'write';
  readonly outputToolName = 'submit_style_check';

  protected buildMessages(_worldId: string, input: StylizerInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildStylizerSystemPrompt(input.worldInfoContext, input.worldContext),
      },
      {
        role: 'user',
        content: buildStylizerUserMessage(
          input.articleTitle,
          input.content,
          input.contentLabel,
          input.userSpec,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_style_check;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): StylizerOutput {
    return SubmitStyleCheckSchema.parse(input);
  }
}
