import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader, buildParentAndFixedPointBlocks } from './shared.js';

export type SummarizerPromptMode = 'full' | 'improve';

export function buildSummarizerSystemPrompt(worldContext: WorldContext, mode: SummarizerPromptMode = 'full'): string {
  if (mode === 'improve') {
    return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: the user has written an Introduction for this article. Treat it as a creative seed and constraint — preserve its core claims, voice, and any specific details. Write a polished introductory paragraph (3–5 sentences, ~80 words) that expands naturally from it, adding depth from world context without contradicting the user's intent.

Rules:
- Preserve the factual core of what the user wrote
- Stay consistent with the Parent Articles and Fixed Points below, if present — use them to avoid contradictions, don't restate them
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
  }

  return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: read the article's ## Description section and distil it into a single Introduction paragraph (3–5 sentences, ~80 words). The Introduction goes into the World Bible — it must be self-contained, specific, and capture what makes this entity unique in the world.

Rules:
- Do not introduce new facts that aren't in the Description
- Stay consistent with the Parent Articles and Fixed Points below, if present — use them to avoid contradictions, don't restate them
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction exactly once when ready
- Do not answer in plain text`;
}

export function buildSummarizerUserMessage(
  articleTitle: string,
  description: string,
  contextPackage: ContextPackage,
  mode: SummarizerPromptMode = 'full',
  existingIntro?: string,
  revisionNotes?: string,
): string {
  const revisionBlock = revisionNotes ? `\n\n## Revision Required\nPlease correct the following contradictions:\n${revisionNotes}` : '';
  const contextBlocks = buildParentAndFixedPointBlocks(contextPackage);

  if (mode === 'improve' && existingIntro) {
    const parts = [
      `## Article: ${articleTitle}`,
      ...contextBlocks,
      `## Existing Introduction (your seed and constraint)\n${existingIntro}`,
      `## Description (for additional context)\n${description}`,
      `Improve the Introduction, keeping its core claims and voice.${revisionBlock}`,
    ];
    return parts.join('\n\n');
  }

  const parts = [
    `## Article: ${articleTitle}`,
    ...contextBlocks,
    `## Description\n${description}`,
    `Write a 1-paragraph Introduction for the World Bible derived from this Description.${revisionBlock}`,
  ];
  return parts.join('\n\n');
}
