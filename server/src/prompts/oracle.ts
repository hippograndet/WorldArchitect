import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
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
  pkg: ContextPackage,
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
    const briefParts: string[] = [];
    if (researchBrief.keyFacts.length > 0) {
      briefParts.push(`**Established facts to respect:**\n${researchBrief.keyFacts.map(f => `- ${f}`).join('\n')}`);
    }
    if (researchBrief.warnings.length > 0) {
      briefParts.push(`**Watch out for:**\n${researchBrief.warnings.map(w => `- ${w}`).join('\n')}`);
    }
    if (researchBrief.suggestedAngles.length > 0) {
      briefParts.push(`**Angles worth developing:**\n${researchBrief.suggestedAngles.map(a => `- ${a}`).join('\n')}`);
    }
    if (briefParts.length > 0) parts.push(`## Research Brief\n${briefParts.join('\n\n')}`);
  }

  if (userSpec) {
    parts.push(`## User Focus\n${userSpec}`);
  }

  if (pkg.parents.length > 0) {
    parts.push('## Parent Context\n' + pkg.parents.map(p => `### ${p.title}\n${p.summary}`).join('\n\n'));
  }
  if (pkg.siblings.length > 0) {
    parts.push('## Sibling Articles\n' + pkg.siblings.map(s => `- **${s.title}**: ${s.summary}`).join('\n'));
  }
  if (pkg.children.length > 0) {
    parts.push('## Existing Sub-Articles\n' + pkg.children.map(c => `- **${c.title}**: ${c.summary}`).join('\n'));
  }

  parts.push('Propose 5–10 distinct thematic ideas for the Description section, aligned with the selected direction.');

  return parts.join('\n\n');
}
