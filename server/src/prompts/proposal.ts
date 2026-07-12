import type { WorldContext } from '../agents/director.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader, dataBlock } from './shared.js';

export type ProposalMode = 'expand_description' | 'create_root' | 'create_child';

export function buildProposalSystemPrompt(worldContext: WorldContext, mode: ProposalMode): string {
  const modeDesc =
    mode === 'create_root' || mode === 'create_child'
      ? 'You are creating a brand-new article. Propose 3 distinct creative identities for what this entity fundamentally IS.'
      : 'You are expanding an existing article stub. Propose 3 distinct creative identities for what this entity fundamentally IS.';

  return `You are the ProposalAgent for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

${modeDesc}

Each proposal defines what this entity fundamentally IS — its nature, character, essence, atmosphere, and place in the world — from a distinct creative angle. These are NOT structural focuses, writing outlines, or section breakdowns.

GOOD example: "A vast ocean planet with scattered volcanic archipelagos, dominated by bioluminescent megafauna and inhabited by nomadic sea-tribes who navigate by the creatures' light patterns." — this is what the entity IS.
BAD example: "Explore the marine ecosystem of Planet Blue Sea" — this is a writing instruction, not an identity.

Each proposal must be:
- A distinct creative identity — different natures, not different angles on the same nature
- Grounded in the research brief below (no contradictions)
- Specific, not generic
- Expressed as: a short title (3–8 words) + a ~60-word description of what the entity IS

When you have read the research brief and are ready, call submit_proposals with exactly 3 proposals.`;
}

export function buildProposalUserMessage(
  articleTitle: string,
  templateType: string,
  currentIntroduction?: string,
  userSpec?: string,
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

  if (userSpec) parts.push(`## User Specification\n${dataBlock('userSpec', userSpec)}`);

  parts.push('Propose 3 creative identities for this entity — what it fundamentally IS, not how to write about it.');

  return parts.join('\n\n');
}
