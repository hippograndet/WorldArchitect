import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildGatekeeperSystemPrompt, buildGatekeeperUserMessage } from '../prompts/gatekeeper.js';
import type { ChildProposalItem } from './cartographer.js';
import { GET_ARTICLE_TOOL, SEARCH_ARTICLES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const DuplicateFlagSchema = z.object({
  proposalTitle:   z.string(),
  matchedExisting: z.string(),
  rationale:       z.string(),
});

const SubmitDedupCheckSchema = z.object({
  duplicates: z.array(DuplicateFlagSchema).default([]),
});

export interface DuplicateFlag {
  proposalTitle:   string;
  matchedExisting: string;
  rationale:       string;
}

export interface GatekeeperOutput {
  duplicates: DuplicateFlag[];
}

/**
 * No contextPackage — checks proposals against a bounded, structural
 * existingChildren list, not the raw neighborhood tiers. No world context
 * either (Table 2): this is a structural title/summary comparison, not
 * creative writing, so world identity/style is irrelevant to the judgment.
 */
export interface GatekeeperInput {
  articleTitle:      string;
  existingChildren?: Array<{ title: string; summary: string }>;
  proposals:         ChildProposalItem[];
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Branching-stage critic: flags proposed children that are semantic/
 * conceptual duplicates of existing sibling articles (not literal title
 * matches — sync rules already catch those). No fuzzy-matching library is
 * used — this is an LLM judgment call, consistent with every other critic
 * in the MAS (Arbiter, Warden, Auditor).
 */
export class GatekeeperAgent extends BaseAgent<GatekeeperInput, GatekeeperOutput> {
  readonly agentType = 'dedup_check';
  readonly mode = 'check';
  readonly outputToolName = 'submit_dedup_check';

  protected getMaxTokens(): number { return 1000; }

  /** get_article + search_articles (v8) — enough to check a candidate against the wider world, not the full escape hatch. */
  protected getContextTools(): Tool[] {
    return [GET_ARTICLE_TOOL, SEARCH_ARTICLES_TOOL];
  }

  protected buildMessages(_worldId: string, input: GatekeeperInput): ChatMessage[] {
    return [
      { role: 'system', content: buildGatekeeperSystemPrompt() },
      { role: 'user', content: buildGatekeeperUserMessage(input.articleTitle, input.existingChildren, input.proposals, input.userSpec) },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_dedup_check;
  }

  protected parseOutput(input: Record<string, unknown>): GatekeeperOutput {
    const parsed = SubmitDedupCheckSchema.parse(input);
    return { duplicates: parsed.duplicates };
  }
}
