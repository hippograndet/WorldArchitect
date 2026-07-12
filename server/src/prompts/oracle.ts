import type { WorldContext } from '../agents/director.js';
import type { ProposalItem } from '../agents/muse.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader } from './shared.js';

export function buildOracleSystemPrompt(worldContext: WorldContext): string {
  return `You are The Oracle for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your role is to propose 5–10 specific thematic ideas, concepts, or narrative threads that the Scribe could explore in the Description section of a given article. Each idea should be:
- Concrete and specific (not vague like "explore its history" — instead "the role of nomadic traders in spreading its early influence")
- Consistent with the world's tone and the selected creative direction
- Varied in scope: mix big-picture themes with detail-level angles
- Directly useful as a paragraph topic

You are NOT writing the Description — you are providing a curated menu of angles for the user to select. Call submit_ideas when ready.`;
}

export function buildOracleUserMessage(
  articleTitle: string,
  introduction: string,
  selectedProposal: ProposalItem,
  userSpec?: string,
  researchBrief?: ResearchBrief,
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `## Introduction\n${introduction}`,
    `## Selected Creative Direction\n**${selectedProposal.title}**\n${selectedProposal.direction}`,
  ];

  if (researchBrief) {
    parts.push(`## Research Brief\n${researchBrief}`);
  }

  if (userSpec) {
    parts.push(`## User Focus\n${userSpec}`);
  }

  parts.push('Propose 5–10 distinct thematic ideas for the Description section, aligned with the selected direction.');

  return parts.join('\n\n');
}
