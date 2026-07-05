import { z } from 'zod';
import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildOracleSystemPrompt, buildOracleUserMessage } from '../prompts/oracle.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ProposalItem } from './muse.js';
import { LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const IdeaItemRawSchema = z.object({
  theme: z.string(),
  detail: z.string(),
});

const SubmitIdeasSchema = z.object({
  ideas: z.array(IdeaItemRawSchema).min(5).max(10),
});

export interface IdeaItem {
  id: string;
  theme: string;
  detail: string;
}

export type OracleOutput = { ideas: IdeaItem[] };

export interface OracleInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  articleTitle: string;
  introduction: string;
  selectedProposal: ProposalItem;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class OracleAgent extends BaseAgent<OracleInput, OracleOutput> {
  readonly agentType = 'oracle';
  readonly mode = 'write';
  readonly outputToolName = 'submit_ideas';

  protected buildMessages(_worldId: string, input: OracleInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildOracleSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildOracleUserMessage(
          input.contextPackage,
          input.articleTitle,
          input.introduction,
          input.selectedProposal,
          input.userSpec,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_ideas;
  }

  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL];
  }

  protected parseOutput(input: Record<string, unknown>): OracleOutput {
    const normalized = Array.isArray(input) ? { ideas: input } : input;
    const parsed = SubmitIdeasSchema.parse(normalized);
    return {
      ideas: parsed.ideas.map(idea => ({ ...idea, id: nanoid() })),
    };
  }
}
