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
  proposals: z.array(ProposalItemSchema).min(1).max(5),
});

export type ProposalItem = z.infer<typeof ProposalItemSchema>;
export type MuseOutput = { proposals: ProposalItem[] };

export interface MuseInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  mode: ProposalMode;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class MuseAgent extends BaseAgent<MuseInput, MuseOutput> {
  readonly agentType = 'muse';
  readonly outputToolName = 'submit_proposals';

  protected buildMessages(_worldId: string, input: MuseInput): ChatMessage[] {
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

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): MuseOutput {
    const parsed = SubmitProposalsSchema.parse(input);
    return { proposals: parsed.proposals };
  }
}
