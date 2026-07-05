import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildExpanderSystemPrompt,
  buildExpanderUserMessage,
  type ExpanderMode,
} from '../prompts/expander.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ProposalItem } from './muse.js';
import type { IdeaItem } from './oracle.js';
import { CONTEXT_TOOLS, LOOKUP_NAMES_TOOL } from '../tools/context.js';
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

export interface ScribeInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  mode: ExpanderMode;
  selectedProposal?: ProposalItem;
  selectedIdeas?: IdeaItem[];
  userSpec?: string;
  researchBrief?: ResearchBrief;
  wordCountPreset?: 'short' | 'medium' | 'long';
}

export interface ResearchBrief {
  keyFacts: string[];
  warnings: string[];
  suggestedAngles: string[];
}

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

  protected getContextTools(): Tool[] {
    return [...CONTEXT_TOOLS, LOOKUP_NAMES_TOOL];
  }

  protected buildMessages(_worldId: string, input: ScribeInput): ChatMessage[] {
    this._mode = input.mode;
    const userContent = buildExpanderUserMessage(
      input.contextPackage,
      input.mode,
      input.selectedProposal,
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
}
