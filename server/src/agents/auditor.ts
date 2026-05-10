import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildAuditorSystemPrompt,
  buildAuditorUserMessage,
  type AuditorArticleSummary,
} from '../prompts/auditor.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const EdgeProposalSchema = z.object({
  sourceArticleId: z.string(),
  sourceArticleTitle: z.string(),
  targetArticleId: z.string(),
  targetArticleTitle: z.string(),
  linkType: z.enum(['references', 'hierarchical']),
  rationale: z.string(),
});

const GlobalWarningSchema = z.object({
  severity: z.enum(['warning', 'conflict']),
  type: z.enum(['coherence', 'gap', 'narrative', 'thematic']),
  description: z.string(),
  involvedArticleIds: z.array(z.string()),
});

const SubmitAuditSchema = z.object({
  edgeProposals: z.array(EdgeProposalSchema),
  globalWarnings: z.array(GlobalWarningSchema),
});

export type EdgeProposal = z.infer<typeof EdgeProposalSchema>;
export type GlobalWarning = z.infer<typeof GlobalWarningSchema>;
export type AuditorOutput = z.infer<typeof SubmitAuditSchema>;

export interface AuditorInput {
  worldContext: WorldContext;
  articleSummaries: AuditorArticleSummary[];
  sampleSize?: number;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class AuditorAgent extends BaseAgent<AuditorInput, AuditorOutput> {
  readonly agentType = 'auditor';
  readonly outputToolName = 'submit_audit';

  protected buildMessages(_worldId: string, input: AuditorInput): ChatMessage[] {
    const summaries = input.sampleSize
      ? input.articleSummaries.slice(0, input.sampleSize)
      : input.articleSummaries;

    return [
      {
        role: 'system',
        content: buildAuditorSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildAuditorUserMessage(summaries),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_audit;
  }

  protected parseOutput(input: Record<string, unknown>): AuditorOutput {
    return SubmitAuditSchema.parse(input);
  }
}
