import type { WorldContext } from '../agents/director.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader } from './shared.js';

export type SummarizerPromptMode = 'full' | 'improve';

export function buildSummarizerSystemPrompt(worldContext: WorldContext, mode: SummarizerPromptMode = 'full'): string {
  if (mode === 'improve') {
    return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: the user has written an Introduction for this article. Treat it as a creative seed and constraint — preserve its core claims, voice, and any specific details. Write a polished introductory paragraph (3–5 sentences, ~80 words) that expands naturally from it, adding depth from the research brief without contradicting the user's intent.

Rules:
- Preserve the factual core of what the user wrote
- Stay consistent with the Research Brief below, if present — use it to avoid contradictions, don't restate it verbatim
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
  }

  return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: write a single Introduction paragraph (3–5 sentences, ~80 words) for this article, grounded in the research brief below. The Introduction goes into the World Bible — it must be self-contained, specific, and capture what makes this entity unique in the world.

Rules:
- Do not introduce facts that aren't in the Research Brief or conspicuously implied by it
- Stay consistent with the Research Brief below, if present
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
}

function buildResearchBriefBlock(researchBrief?: ResearchBrief): string[] {
  return researchBrief ? [`## Research Brief\n${researchBrief}`] : [];
}

export function buildSummarizerUserMessage(
  articleTitle: string,
  mode: SummarizerPromptMode = 'full',
  existingIntro?: string,
  revisionNotes?: string,
  researchBrief?: ResearchBrief,
): string {
  const revisionBlock = revisionNotes ? `\n\n## Revision Required\nPlease correct the following contradictions:\n${revisionNotes}` : '';
  const researchBriefBlock = buildResearchBriefBlock(researchBrief);

  if (mode === 'improve' && existingIntro) {
    const parts = [
      `## Article: ${articleTitle}`,
      ...researchBriefBlock,
      `## Existing Introduction (your seed and constraint)\n${existingIntro}`,
      `Improve the Introduction, keeping its core claims and voice.${revisionBlock}`,
    ];
    return parts.join('\n\n');
  }

  const parts = [
    `## Article: ${articleTitle}`,
    ...researchBriefBlock,
    `Write a 1-paragraph Introduction for the World Bible, grounded in the research brief above.${revisionBlock}`,
  ];
  return parts.join('\n\n');
}
