import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildCoherenceSystemPrompt, buildCoherenceUserMessage } from '../prompts/coherence.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const CoherenceWarningSchema = z.object({
  severity: z.enum(['warning', 'conflict']),
  description: z.string(),
  sourceArticleId: z.string().nullable().optional(),
});

const SuggestedLinkSchema = z.object({
  targetArticleTitle: z.string(),
  targetArticleId: z.string().nullable().optional(),
});

const SubmitCoherenceCheckSchema = z.object({
  warnings: z.array(CoherenceWarningSchema),
  suggestedLinks: z.array(SuggestedLinkSchema),
});

export type CoherenceWarning = z.infer<typeof CoherenceWarningSchema>;
export type SuggestedLink = z.infer<typeof SuggestedLinkSchema>;
export type WardenOutput = { warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[] };

export interface WardenInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  newContent: string;
  contentLabel: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class WardenAgent extends BaseAgent<WardenInput, WardenOutput> {
  readonly agentType = 'warden';
  readonly mode = 'check';
  readonly outputToolName = 'submit_coherence_check';

  protected buildMessages(_worldId: string, input: WardenInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildCoherenceSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildCoherenceUserMessage(
          input.contextPackage,
          input.newContent,
          input.contentLabel,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_coherence_check;
  }

  protected parseOutput(input: Record<string, unknown>): WardenOutput {
    const parsed = SubmitCoherenceCheckSchema.parse(input);
    return { warnings: parsed.warnings, suggestedLinks: parsed.suggestedLinks };
  }
}
