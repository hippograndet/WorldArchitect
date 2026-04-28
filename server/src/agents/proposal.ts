import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildProposalSystemPrompt,
  buildProposalUserMessage,
  type ProposalMode,
} from '../prompts/proposal.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const ProposalItemSchema = z.object({
  title: z.string(),
  direction: z.string(),
});

const SubmitProposalsSchema = z.object({
  proposals: z.array(ProposalItemSchema).min(1).max(3),
});

export type ProposalItem = z.infer<typeof ProposalItemSchema>;
export type ProposalOutput = { proposals: ProposalItem[] };

export interface ProposalInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  mode: ProposalMode;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ProposalAgent extends BaseAgent<ProposalInput, ProposalOutput> {
  readonly agentType = 'proposal';
  readonly outputToolName = 'submit_proposals';

  protected buildMessages(worldId: string, input: ProposalInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildProposalSystemPrompt(input.worldContext, input.mode),
      },
      {
        role: 'user',
        content: buildProposalUserMessage(input.contextPackage, input.userSpec),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_proposals;
  }

  // No context tools needed — ContextPackage is pre-built by Archivist
  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): ProposalOutput {
    const parsed = SubmitProposalsSchema.parse(input);
    return { proposals: parsed.proposals };
  }
}
