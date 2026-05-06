import type { WorldContext } from '../agents/director.js';
import type { ProposalItem } from '../agents/muse.js';
import { buildWorldHeader } from './shared.js';

export function buildTasteSystemPrompt(worldContext: WorldContext): string {
  return `You are the TasteAgent for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: you are given 3 creative direction proposals for a fiction article. Select the one that best fits the world's established aesthetic, style, and inspirations.

Prefer proposals that are:
- Tonally consistent with the world's vibe and inspirations
- Specific rather than generic
- Most distinct from what likely already exists (avoid repetition)
- Narratively interesting given the world's writing style

Call submit_taste_selection with the index (0, 1, or 2) of the best proposal and a 1-sentence rationale.`;
}

export function buildTasteUserMessage(
  articleTitle: string,
  articleTemplateType: string,
  proposals: ProposalItem[],
  currentSummary?: string,
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `Template type: ${articleTemplateType}`,
  ];

  if (currentSummary) {
    parts.push(`Current Introduction:\n${currentSummary}`);
  }

  parts.push('## Proposals\n' + proposals.map((p, i) =>
    `### Option ${i} — ${p.title}\n${p.direction}`
  ).join('\n\n'));

  parts.push('Select the proposal that best fits this world\'s style and aesthetic.');

  return parts.join('\n\n');
}
