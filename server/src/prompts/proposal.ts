import type { WorldContext } from '../agents/director.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader, dataBlock } from './shared.js';

export type ProposalMode = 'expand_description' | 'create_root' | 'create_child';

export function buildProposalSystemPrompt(worldContext: WorldContext, mode: ProposalMode): string {
  const modeDesc =
    mode === 'create_root' || mode === 'create_child'
      ? 'You are creating a brand-new article.'
      : 'You are expanding an existing article stub.';

  return `You are Muse for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

${modeDesc} Propose 5–10 specific thematic ideas, concepts, or narrative threads that the Scribe could explore in the Description section. Each idea should be:
- Concrete and specific (not vague like "explore its history" — instead "the role of nomadic traders in spreading its early influence")
- Consistent with the world's tone and the article's own established identity (its introduction, if any)
- Varied in scope: mix big-picture themes with detail-level angles
- Directly useful as a paragraph topic
- Grounded in the research brief below (no contradictions)

You are NOT writing the Description — you are providing a curated menu of angles for a Curator (or the user) to select from. Base this only on the world's established context and the article's own identity — do not guess at what a user might personally want; that judgment happens downstream. Call submit_ideas when ready.`;
}

export function buildProposalUserMessage(
  articleTitle: string,
  templateType: string,
  currentIntroduction?: string,
  researchBrief?: ResearchBrief,
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `Template type: ${templateType}`,
  ];

  if (currentIntroduction) {
    parts.push(`Current Introduction:\n${dataBlock('target.introduction', currentIntroduction)}`);
  }

  if (researchBrief) {
    parts.push(`## Research Brief\n${researchBrief}`);
  }

  parts.push('Propose 5–10 distinct thematic ideas for the Description section.');

  return parts.join('\n\n');
}
