import type { WorldContext } from '../agents/director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldInfoHeader, buildWorldStyleHeader, toWorldStyleContext, dataBlock } from './shared.js';

export type HeraldPromptMode = 'full' | 'improve';

function buildWorldBlock(worldInfoContext: WorldInfoContext, worldContext: WorldContext): string {
  // All three style pairs — writing the actual introduction prose is
  // Herald's whole job, unlike Muse/Curator's angle-only work (Table 2).
  const stylePairs = toWorldStyleContext(worldContext.styleConfig);
  return [buildWorldInfoHeader(worldInfoContext), buildWorldStyleHeader(stylePairs)].filter(Boolean).join('\n');
}

export function buildHeraldSystemPrompt(worldInfoContext: WorldInfoContext, worldContext: WorldContext, mode: HeraldPromptMode = 'full'): string {
  const worldBlock = buildWorldBlock(worldInfoContext, worldContext);

  if (mode === 'improve') {
    return `You are Herald for WorldArchitect, a fiction world-building tool.

${worldBlock}

Your task: the user has written an Introduction for this article. Treat it as a creative seed and constraint — preserve its core claims, voice, and any specific details. Write a polished introductory paragraph (3–5 sentences, ~80 words) that expands naturally from it, adding depth from the research brief without contradicting the user's intent.

Rules:
- Preserve the factual core of what the user wrote
- Stay consistent with the Research Brief below, if present — use it to avoid contradictions, don't restate it verbatim
- Do not use the article's title as the first word
- Write in the same tone as the world
- If user guidance is given below, weigh it heavily
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
  }

  return `You are Herald for WorldArchitect, a fiction world-building tool.

${worldBlock}

Your task: write a single Introduction paragraph (3–5 sentences, ~80 words) for this article, grounded in the research brief below. The Introduction goes into the World Bible — it must be self-contained, specific, and capture what makes this entity unique in the world.

Rules:
- Do not introduce facts that aren't in the Research Brief or conspicuously implied by it
- Stay consistent with the Research Brief below, if present
- Do not use the article's title as the first word
- Write in the same tone as the world
- If user guidance is given below, weigh it heavily
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
}

function buildResearchBriefBlock(researchBrief?: ResearchBrief): string[] {
  return researchBrief ? [`## Research Brief\n${researchBrief}`] : [];
}

export function buildHeraldUserMessage(
  articleTitle: string,
  mode: HeraldPromptMode = 'full',
  existingIntro?: string,
  revisionNotes?: string,
  researchBrief?: ResearchBrief,
  userSpec?: string,
): string {
  const revisionBlock = revisionNotes ? `\n\n## Revision Required\nPlease correct the following contradictions:\n${revisionNotes}` : '';
  const researchBriefBlock = buildResearchBriefBlock(researchBrief);
  const userSpecBlock = userSpec ? [`## User Guidance\n${dataBlock('userSpec', userSpec)}`] : [];

  if (mode === 'improve' && existingIntro) {
    const parts = [
      `## Article: ${articleTitle}`,
      ...researchBriefBlock,
      `## Existing Introduction (your seed and constraint)\n${existingIntro}`,
      ...userSpecBlock,
      `Improve the Introduction, keeping its core claims and voice.${revisionBlock}`,
    ];
    return parts.join('\n\n');
  }

  const parts = [
    `## Article: ${articleTitle}`,
    ...researchBriefBlock,
    ...userSpecBlock,
    `Write a 1-paragraph Introduction for the World Bible, grounded in the research brief above.${revisionBlock}`,
  ];
  return parts.join('\n\n');
}
