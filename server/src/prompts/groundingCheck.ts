import type { WorldContext } from '../agents/director.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader } from './shared.js';

export function buildGroundingCheckSystemPrompt(worldContext: WorldContext): string {
  return `You are the Grounding Check for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

A writer (Lorekeeper) has just produced a draft Introduction for an article. Your job is a targeted self-correction pass: check the draft against the research brief for factual contradictions.

Focus only on contradictions — places where the draft states something that directly conflicts with an established fact. Do NOT flag:
- Creative choices or interpretations not explicitly contradicted by facts
- Missing information (the Introduction does not need to cover everything)
- Style or tone differences
- Minor ambiguities

For each contradiction you find:
- Quote the exact offending excerpt from the draft
- Identify what established fact it contradicts
- Suggest a minimal correction (rewording, not a full rewrite)

If you find no contradictions, set approved: true and leave contradictions empty.
If you find contradictions, set approved: false and list them.

Call submit_grounding_check with your assessment.`;
}

export function buildGroundingCheckUserMessage(articleTitle: string, draft: string, researchBrief?: ResearchBrief): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
  ];

  if (researchBrief) {
    parts.push(`## Research Brief\n${researchBrief}`);
  }

  parts.push(`## Draft Introduction to Review\n${draft}`);
  parts.push('Check the draft for factual contradictions against the research brief. Call submit_grounding_check.');

  return parts.join('\n\n');
}
