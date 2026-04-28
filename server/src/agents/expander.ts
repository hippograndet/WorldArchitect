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
import type { ProposalItem } from './proposal.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SuggestedLinkSchema = z.object({
  targetArticleTitle: z.string(),
  targetArticleId: z.string().nullable().optional(),
});

const TemporalAnchorSchema = z
  .object({ start: z.string(), end: z.string().optional() })
  .nullable()
  .optional();

const SubmitDescriptionSchema = z.object({
  description: z.string(),
  suggestedLinks: z.array(SuggestedLinkSchema).optional().default([]),
  temporalAnchor: TemporalAnchorSchema,
});

const SubmitChildDescriptionSchema = z.object({
  childDescription: z.string(),
  parentAppend: z.string(),
  suggestedLinks: z.array(SuggestedLinkSchema).optional().default([]),
  temporalAnchor: TemporalAnchorSchema,
});

export type ExpanderOutput =
  | { mode: 'single'; description: string; suggestedLinks: { targetArticleTitle: string; targetArticleId?: string | null }[]; temporalAnchor?: { start: string; end?: string } | null }
  | { mode: 'child'; childDescription: string; parentAppend: string; suggestedLinks: { targetArticleTitle: string; targetArticleId?: string | null }[]; temporalAnchor?: { start: string; end?: string } | null };

export interface ExpanderInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  mode: ExpanderMode;
  selectedProposal?: ProposalItem;
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ExpanderAgent extends BaseAgent<ExpanderInput, ExpanderOutput> {
  readonly agentType = 'expander';

  get outputToolName(): string {
    return this._mode === 'create_child' ? 'submit_child_description' : 'submit_description';
  }

  private _mode: ExpanderMode = 'expand_description';

  protected buildMessages(_worldId: string, input: ExpanderInput): ChatMessage[] {
    this._mode = input.mode;
    return [
      {
        role: 'system',
        content: buildExpanderSystemPrompt(input.worldContext, input.mode),
      },
      {
        role: 'user',
        content: buildExpanderUserMessage(
          input.contextPackage,
          input.mode,
          input.selectedProposal,
          input.userSpec,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return this._mode === 'create_child'
      ? OUTPUT_TOOLS.submit_child_description
      : OUTPUT_TOOLS.submit_description;
  }

  protected parseOutput(input: Record<string, unknown>): ExpanderOutput {
    if (this._mode === 'create_child') {
      const parsed = SubmitChildDescriptionSchema.parse(input);
      return {
        mode: 'child',
        childDescription: parsed.childDescription,
        parentAppend: parsed.parentAppend,
        suggestedLinks: parsed.suggestedLinks,
        temporalAnchor: parsed.temporalAnchor,
      };
    }
    const parsed = SubmitDescriptionSchema.parse(input);
    return {
      mode: 'single',
      description: parsed.description,
      suggestedLinks: parsed.suggestedLinks,
      temporalAnchor: parsed.temporalAnchor,
    };
  }
}
