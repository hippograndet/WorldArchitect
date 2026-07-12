import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildChildProposerSystemPrompt, buildChildProposerUserMessage } from '../prompts/childProposer.js';
import type { WorldContext } from './director.js';
import type { ResearchBrief } from './scribe.js';
import { LOOKUP_NAMES_TOOL } from '../tools/context.js';
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

/**
 * No contextPackage — Cartographer writes from the parent article's own
 * identity/content + Researcher's brief, not the raw neighborhood tiers.
 * existingChildren is the one deliberate exception: a bounded, structural
 * list (this article's own direct children only, never world-wide) needed
 * to self-avoid an obvious duplicate — not a "fact" the brief would carry.
 */
export interface CartographerInput {
  worldContext: WorldContext;
  articleTitle: string;
  templateType: string;
  currentIntroduction?: string;
  currentDescription?: string;
  existingChildren?: Array<{ title: string; summary: string }>;
  userSpec?: string;
  researchBrief?: ResearchBrief;
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
        content: buildChildProposerUserMessage(
          input.articleTitle,
          input.templateType,
          input.currentIntroduction,
          input.currentDescription,
          input.existingChildren,
          input.userSpec,
          input.researchBrief,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_child_proposals;
  }

  protected getMaxTokens(): number { return 1500; }

  /**
   * lookup_names only (v9) — Cartographer is a generator: it gets the
   * curated ContextPackage + Researcher's brief but no independent
   * world-context retrieval tools. It previously also carried
   * search_articles as a self-check, but that duplicated Dedup Check's own
   * search_articles access on the same duplicate-detection question; that
   * capability now lives exclusively on Dedup Check. Note: when
   * forgeUseDedupCheck/runDedupCheck is off, Branching has no duplicate
   * protection beyond Sync Rules' literal-title match — an accepted
   * trade-off for a clean generator/checker split, not an oversight.
   * lookup_names is kept since it's a Name Bank utility, not world-context
   * retrieval.
   */
  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL];
  }

  protected parseOutput(input: Record<string, unknown>): CartographerOutput {
    const parsed = SubmitChildProposalsSchema.parse(input);
    return { proposals: parsed.proposals };
  }
}
