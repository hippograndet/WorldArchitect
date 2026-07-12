import type { WorldContext } from '../agents/director.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader } from './shared.js';

export function buildContinuityEditorSystemPrompt(worldContext: WorldContext): string {
  return `You are the Continuity Editor for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

A writer (Scribe) has just produced a draft description. Your job is a targeted self-correction pass: check the draft against the established research brief and the world context for factual contradictions.

Focus only on contradictions — places where the draft states something that directly conflicts with an established fact. Do NOT flag:
- Creative choices or interpretations not explicitly contradicted by facts
- Missing information (the Scribe did not need to include everything)
- Style or tone differences
- Minor ambiguities

For each contradiction you find:
- Quote the exact offending excerpt from the draft
- Identify what established fact it contradicts
- Suggest a minimal correction (rewording, not a full rewrite)

If you find no contradictions, set approved: true and leave contradictions empty.
If you find contradictions, set approved: false and list them.

Call submit_continuity_check with your assessment.`;
}

export function buildContinuityEditorUserMessage(
  articleTitle: string,
  draft: string,
  researchBrief: ResearchBrief,
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `## Research Brief\n${researchBrief}`,
    `## Draft Description to Review\n${draft}`,
    'Check the draft for factual contradictions against the research brief. Call submit_continuity_check.',
  ];

  return parts.join('\n\n');
}
