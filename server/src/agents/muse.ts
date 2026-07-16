import { z } from 'zod';
import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildProposalSystemPrompt,
  buildProposalUserMessage,
  type ProposalMode,
} from '../prompts/proposal.js';
import type { WorldContext } from './director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { ResearchBrief } from './scribe.js';
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

export type MuseOutput = { ideas: IdeaItem[] };

/** No contextPackage, no userSpec — Muse writes from the article's own identity + world context + Researcher's brief only. User preference enters downstream, via Curator. */
export interface MuseInput {
  worldInfoContext: WorldInfoContext;
  worldContext: WorldContext;
  mode: ProposalMode;
  articleTitle: string;
  templateType: string;
  currentIntroduction?: string;
  researchBrief?: ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class MuseAgent extends BaseAgent<MuseInput, MuseOutput> {
  readonly agentType = 'muse';
  readonly mode = 'write';
  readonly outputToolName = 'submit_ideas';

  protected buildMessages(_worldId: string, input: MuseInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildProposalSystemPrompt(input.worldInfoContext, input.worldContext, input.mode),
      },
      {
        role: 'user',
        content: buildProposalUserMessage(input.articleTitle, input.templateType, input.currentIntroduction, input.researchBrief),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_ideas;
  }

  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL];
  }

  protected parseOutput(input: Record<string, unknown>): MuseOutput {
    const parsed = SubmitIdeasSchema.parse(input);
    return { ideas: parsed.ideas.map((idea) => ({ ...idea, id: nanoid() })) };
  }
}
