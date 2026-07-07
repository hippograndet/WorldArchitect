import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildChildProposerSystemPrompt, buildChildProposerUserMessage } from '../prompts/childProposer.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import { LOOKUP_NAMES_TOOL, SEARCH_ARTICLES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const ChildProposalItemSchema = z.object({
  title: z.string(),
  introduction: z.string(),
  templateType: z.enum(['general', 'character', 'location', 'faction']),
  nodeKind: z.enum(['conceptual', 'instance']),
  nodeKindRationale: z.string(),
});

const SubmitChildProposalsSchema = z.object({
  proposals: z.array(ChildProposalItemSchema).min(1).max(5),
});

export type ChildProposalItem = z.infer<typeof ChildProposalItemSchema>;
export type CartographerOutput = { proposals: ChildProposalItem[] };

export interface CartographerInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CartographerAgent extends BaseAgent<CartographerInput, CartographerOutput> {
  readonly agentType = 'cartographer';
  readonly mode = 'write';
  readonly outputToolName = 'submit_child_proposals';

  protected buildMessages(_worldId: string, input: CartographerInput): ChatMessage[] {
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

  protected getMaxTokens(): number { return 1500; }

  /** lookup_names + search_articles (v8) — search_articles lets Cartographer self-avoid proposing a child that duplicates an existing article, before Dedup Check ever has to filter one out. */
  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL, SEARCH_ARTICLES_TOOL];
  }

  protected parseOutput(input: Record<string, unknown>): CartographerOutput {
    const parsed = SubmitChildProposalsSchema.parse(input);
    return { proposals: parsed.proposals };
  }
}
