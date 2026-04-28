import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildChildProposerSystemPrompt, buildChildProposerUserMessage } from '../prompts/childProposer.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const ChildProposalItemSchema = z.object({
  title: z.string(),
  introduction: z.string(),
  templateType: z.enum(['general', 'character', 'location', 'faction']),
});

const SubmitChildProposalsSchema = z.object({
  proposals: z.array(ChildProposalItemSchema).min(1).max(10),
});

export type ChildProposalItem = z.infer<typeof ChildProposalItemSchema>;
export type ChildProposerOutput = { proposals: ChildProposalItem[] };

export interface ChildProposerInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ChildProposerAgent extends BaseAgent<ChildProposerInput, ChildProposerOutput> {
  readonly agentType = 'child_proposer';
  readonly outputToolName = 'submit_child_proposals';

  protected buildMessages(_worldId: string, input: ChildProposerInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildChildProposerSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildChildProposerUserMessage(input.contextPackage, input.userSpec),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_child_proposals;
  }

  // No live DB context tools needed — ContextPackage (with children) is pre-built
  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): ChildProposerOutput {
    const parsed = SubmitChildProposalsSchema.parse(input);
    return { proposals: parsed.proposals };
  }
}
