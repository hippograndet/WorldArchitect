import type { WorldContext } from '../agents/director.js';
import type { IdeaItem } from '../agents/muse.js';
import { buildWorldHeader, dataBlock } from './shared.js';

export function buildTasteSystemPrompt(worldContext: WorldContext): string {
  return `You are Curator for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: you are given a list of thematic ideas Muse proposed for a fiction article's Description, and you select the best subset for the Scribe to actually write from.

If a user preference is given below, weigh it heavily — it reflects what the user actually wants for this article, and should be the primary factor in which ideas you keep.

If no user preference is given, fall back to selecting the ideas that are:
- Tonally consistent with the world's vibe and inspirations
- Specific rather than generic
- Most distinct from what likely already exists (avoid repetition)
- Narratively interesting given the world's writing style

Call submit_taste_selection with the indices of the ideas you select and a 1-sentence rationale.`;
}

export function buildTasteUserMessage(
  articleTitle: string,
  articleTemplateType: string,
  ideas: IdeaItem[],
  currentSummary?: string,
  userSpec?: string,
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `Template type: ${articleTemplateType}`,
  ];

  if (currentSummary) {
    parts.push(`Current Introduction:\n${currentSummary}`);
  }

  parts.push('## Ideas\n' + ideas.map((idea, i) =>
    `### Option ${i} — ${idea.theme}\n${idea.detail}`
  ).join('\n\n'));

  if (userSpec) {
    parts.push(`## User Preference\n${dataBlock('userSpec', userSpec)}`);
  }

  parts.push(userSpec
    ? 'Select the ideas that best fit the user\'s stated preference above.'
    : 'Select the ideas that best fit this world\'s style and aesthetic.');

  return parts.join('\n\n');
}
