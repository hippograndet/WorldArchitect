import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildPromptEngineerSystemPrompt,
  buildPromptEngineerUserMessage,
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  buildCharterAssistSystemPrompt,
  buildCharterAssistUserMessage,
  buildArticleBriefSystemPrompt,
  buildArticleBriefUserMessage,
  buildIntroSeedSystemPrompt,
  buildIntroSeedUserMessage,
  buildPromptLabSystemPrompt,
  buildPromptLabUserMessage,
  type PromptEngineerFieldType,
} from '../prompts/promptEngineer.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitExpansionSchema   = z.object({ expandedDescription: z.string().min(1) });
const SubmitStylePatchSchema  = z.object({ vibe_append: z.string().min(1), writingStyle_append: z.string().min(1) });
const SubmitCharterSuggestionsSchema = z.object({
  premiseSuggestions: z.array(z.string()).default([]),
  authoritySuggestions: z.array(z.string()).default([]),
  atmosphereSuggestions: z.array(z.string()).default([]),
  proseSuggestions: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});
const SubmitArticleBriefSchema = z.object({ userSpec: z.string().min(1) });
const SubmitIntroSeedSchema    = z.object({ introduction: z.string().min(1) });

export type StylistOutput =
  | { mode: 'expand';         expandedDescription: string }
  | { mode: 'distill';        vibe_append: string; writingStyle_append: string }
  | {
      mode: 'charter_assist';
      premiseSuggestions: string[];
      authoritySuggestions: string[];
      atmosphereSuggestions: string[];
      proseSuggestions: string[];
      rationale: string;
    }
  | { mode: 'article_brief';  userSpec: string }
  | { mode: 'intro_seed';     introduction: string };

export interface StylistInput {
  fieldType: PromptEngineerFieldType;
  rawText: string;
  worldName: string;
  worldDescription: string;
  currentVibe?: string;
  currentWritingStyle?: string;
  currentAuthority?: string;
  articleTitle?: string;
  articleType?: string;
  focus?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class StylistAgent extends BaseAgent<StylistInput, StylistOutput> {
  readonly agentType = 'stylist';
  readonly mode = 'write';

  private _input: StylistInput | null = null;

  get outputToolName(): string {
    switch (this._input?.fieldType) {
      case 'distill':       return 'submit_style_patch';
      case 'charter_assist': return 'submit_charter_suggestions';
      case 'article_brief': return 'submit_article_brief';
      case 'intro_seed':    return 'submit_intro_seed';
      default:              return 'submit_prompt_expansion';
    }
  }

  protected buildMessages(_worldId: string, input: StylistInput): ChatMessage[] {
    this._input = input;

    if (input.fieldType === 'distill') {
      return [
        { role: 'system', content: buildDistillSystemPrompt() },
        {
          role: 'user',
          content: buildDistillUserMessage(
            input.rawText, input.worldName, input.worldDescription,
            input.currentVibe ?? '', input.currentWritingStyle ?? '',
          ),
        },
      ];
    }

    if (input.fieldType === 'article_brief') {
      return [
        { role: 'system', content: buildArticleBriefSystemPrompt() },
        {
          role: 'user',
          content: buildArticleBriefUserMessage(
            input.rawText, input.worldName, input.worldDescription,
            input.articleTitle, input.articleType,
          ),
        },
      ];
    }

    if (input.fieldType === 'charter_assist') {
      return [
        { role: 'system', content: buildCharterAssistSystemPrompt() },
        {
          role: 'user',
          content: buildCharterAssistUserMessage(
            input.rawText, input.worldName, input.worldDescription,
            input.currentAuthority ?? '', input.currentVibe ?? '', input.currentWritingStyle ?? '',
          ),
        },
      ];
    }

    if (input.fieldType === 'intro_seed') {
      return [
        { role: 'system', content: buildIntroSeedSystemPrompt() },
        {
          role: 'user',
          content: buildIntroSeedUserMessage(
            input.rawText, input.worldName, input.worldDescription,
            input.articleTitle, input.articleType,
          ),
        },
      ];
    }

    if (input.fieldType === 'prompt_lab') {
      return [
        { role: 'system', content: buildPromptLabSystemPrompt(input.focus) },
        {
          role: 'user',
          content: buildPromptLabUserMessage(
            input.rawText, input.worldName, input.worldDescription, input.focus,
          ),
        },
      ];
    }

    // expand modes: vibe | writing_style
    return [
      { role: 'system', content: buildPromptEngineerSystemPrompt() },
      {
        role: 'user',
        content: buildPromptEngineerUserMessage(
          input.fieldType as 'vibe' | 'writing_style',
          input.rawText, input.worldName, input.worldDescription,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    switch (this._input?.fieldType) {
      case 'distill':       return OUTPUT_TOOLS.submit_style_patch;
      case 'charter_assist': return OUTPUT_TOOLS.submit_charter_suggestions;
      case 'article_brief': return OUTPUT_TOOLS.submit_article_brief;
      case 'intro_seed':    return OUTPUT_TOOLS.submit_intro_seed;
      default:              return OUTPUT_TOOLS.submit_prompt_expansion;
    }
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): StylistOutput {
    switch (this._input?.fieldType) {
      case 'distill': {
        const p = SubmitStylePatchSchema.parse(input);
        return { mode: 'distill', vibe_append: p.vibe_append, writingStyle_append: p.writingStyle_append };
      }
      case 'charter_assist': {
        const p = SubmitCharterSuggestionsSchema.parse(input);
        return {
          mode: 'charter_assist',
          premiseSuggestions: p.premiseSuggestions,
          authoritySuggestions: p.authoritySuggestions,
          atmosphereSuggestions: p.atmosphereSuggestions,
          proseSuggestions: p.proseSuggestions,
          rationale: p.rationale,
        };
      }
      case 'article_brief': {
        const p = SubmitArticleBriefSchema.parse(input);
        return { mode: 'article_brief', userSpec: p.userSpec };
      }
      case 'intro_seed': {
        const p = SubmitIntroSeedSchema.parse(input);
        return { mode: 'intro_seed', introduction: p.introduction };
      }
      default: {
        const p = SubmitExpansionSchema.parse(input);
        return { mode: 'expand', expandedDescription: p.expandedDescription };
      }
    }
  }
}
