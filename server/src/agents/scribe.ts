import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildExpanderSystemPrompt,
  buildExpanderUserMessage,
  type ExpanderMode,
} from '../prompts/expander.js';
import type { WorldContext } from './director.js';
import type { IdeaItem } from './muse.js';
import { LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const MentionSchema = z.object({
  title:        z.string().min(1),
  templateType: z.enum(['general', 'character', 'location', 'faction', 'historical_event']).default('general'),
  summary:      z.string().optional(),
});

export type MentionItem = z.infer<typeof MentionSchema>;

const SubmitDescriptionSchema = z.object({
  description: z.string(),
  mentions:    z.array(MentionSchema).optional(),
});

const SubmitChildDescriptionSchema = z.object({
  childDescription: z.string(),
  parentAppend:     z.string(),
  mentions:         z.array(MentionSchema).optional(),
});

export type ScribeOutput =
  | { mode: 'single'; description: string; mentions?: MentionItem[] }
  | { mode: 'child'; childDescription: string; parentAppend: string; mentions?: MentionItem[] };

/**
 * No contextPackage — Scribe writes from the article's own identity/prior
 * content + Researcher's brief, not the raw neighborhood tiers. currentDescription
 * and currentChronology are only meaningful in 'reorganize' mode, where they're
 * the read-only content being reorganized (Scribe's own prior output, not
 * neighborhood data — that's why they survive here specifically).
 */
export interface ScribeInput {
  worldContext: WorldContext;
  mode: ExpanderMode;
  articleTitle: string;
  templateType: string;
  currentIntroduction?: string;
  currentDescription?: string;
  currentChronology?: string;
  selectedIdeas?: IdeaItem[];
  userSpec?: string;
  researchBrief?: ResearchBrief;
  wordCountPreset?: 'short' | 'medium' | 'long';
}

/** A flowing prose brief — not a rigid struct — covering established facts, watch-out-for tensions, and unexplored angles for one article. */
export type ResearchBrief = string;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ScribeAgent extends BaseAgent<ScribeInput, ScribeOutput> {
  readonly agentType = 'scribe';
  readonly mode = 'write';

  get outputToolName(): string {
    return this._mode === 'create_child' ? 'submit_child_description' : 'submit_description';
  }

  private _mode: ExpanderMode = 'expand_description';

  protected getMaxTokens(): number { return 2000; }

  protected getOutputMode(): 'tool' | 'text' {
    return this._mode === 'create_child' ? 'tool' : 'text';
  }

  /**
   * lookup_names only (v9) — Scribe is a generator: it gets the curated
   * ContextPackage + Researcher's brief but no independent world-context
   * retrieval tools. Researcher is now the single upstream retrieval step
   * for Expand, so a generator re-querying the world independently was
   * redundant. lookup_names is kept since it's a Name Bank utility, not
   * world-context retrieval.
   */
  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL];
  }

  protected buildMessages(_worldId: string, input: ScribeInput): ChatMessage[] {
    this._mode = input.mode;
    const userContent = buildExpanderUserMessage(
      input.articleTitle,
      input.templateType,
      input.mode,
      input.currentIntroduction,
      input.currentDescription,
      input.currentChronology,
      input.userSpec,
      input.selectedIdeas,
      input.researchBrief,
    );
    return [
      { role: 'system', content: buildExpanderSystemPrompt(input.worldContext, input.mode, input.wordCountPreset) },
      { role: 'user',   content: userContent },
    ];
  }

  protected buildOutputTool(): Tool {
    return this._mode === 'create_child'
      ? OUTPUT_TOOLS.submit_child_description
      : OUTPUT_TOOLS.submit_description;
  }

  protected parseOutput(input: Record<string, unknown>): ScribeOutput {
    if (this._mode === 'create_child') {
      const parsed = SubmitChildDescriptionSchema.parse(input);
      return {
        mode: 'child',
        childDescription: parsed.childDescription,
        parentAppend:     parsed.parentAppend,
        mentions:         parsed.mentions,
      };
    }
    const parsed = SubmitDescriptionSchema.parse(input);
    return { mode: 'single', description: parsed.description, mentions: parsed.mentions };
  }

  protected parseTextOutput(content: string): ScribeOutput {
    if (this._mode === 'create_child') return this.parseOutput({ description: content });
    const description = content.trim();
    if (!description) throw new Error('Scribe returned an empty description.');
    if (/^#{1,6}\s*Description\b/im.test(description)) {
      throw new Error('Scribe returned a Description heading; expected body prose only.');
    }
    return { mode: 'single', description };
  }
}
