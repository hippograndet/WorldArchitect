import { z } from 'zod';
import { BaseAgent } from './base.js';
import type { ContextPackage } from '../services/archivist.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';
import type { MentionItem } from './scribe.js';
import { dataBlock } from '../prompts/shared.js';

const MentionSchema = z.object({
  title: z.string().min(1),
  templateType: z.enum(['general', 'character', 'location', 'faction', 'historical_event']).default('general'),
  summary: z.string().optional(),
});

const SubmitMentionsSchema = z.object({
  mentions: z.array(MentionSchema),
});

export interface MentionExtractorInput {
  contextPackage: ContextPackage;
  description: string;
}

export interface MentionExtractorOutput {
  mentions: MentionItem[];
}

export class MentionExtractorAgent extends BaseAgent<MentionExtractorInput, MentionExtractorOutput> {
  readonly agentType = 'mention_extractor';
  readonly outputToolName = 'submit_mentions';
  readonly mode = 'check' as const;

  protected getMaxTokens(): number { return 700; }

  protected getMaxIterations(): number { return 2; }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected buildMessages(_worldId: string, input: MentionExtractorInput): ChatMessage[] {
    const knownTitles = [
      input.contextPackage.targetTitle,
      ...input.contextPackage.parents.map((item) => item.title),
      ...input.contextPackage.siblings.map((item) => item.title),
      ...input.contextPackage.children.map((item) => item.title),
      ...input.contextPackage.referencedArticles.map((item) => item.title),
    ].filter(Boolean);

    return [
      {
        role: 'system',
        content: `You extract only significant brand-new entity mentions from WorldArchitect draft prose.

Call submit_mentions exactly once.

Include only central new characters, locations, factions, historical events, or major concepts coined by the draft.
Do not include the article itself, parent articles, sibling articles, child articles, referenced articles, generic nouns, adjectives, passing references, or poetic phrases.
If there are no genuinely new central entities, return an empty mentions array.`,
      },
      {
        role: 'user',
        content: [
          `## Article: ${input.contextPackage.targetTitle}`,
          `Template type: ${input.contextPackage.targetTemplateType}`,
          `## Known Article Titles To Exclude\n${dataBlock('knownTitles', knownTitles)}`,
          `## Draft Description\n${dataBlock('description', input.description)}`,
        ].join('\n\n'),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_mentions;
  }

  protected parseOutput(input: Record<string, unknown>): MentionExtractorOutput {
    const parsed = SubmitMentionsSchema.parse(input);
    return { mentions: parsed.mentions };
  }
}
