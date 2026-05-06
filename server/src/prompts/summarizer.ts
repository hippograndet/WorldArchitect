import type { WorldContext } from '../agents/director.js';
import { buildWorldHeader } from './shared.js';

export type SummarizerPromptMode = 'full' | 'improve';

export function buildSummarizerSystemPrompt(worldContext: WorldContext, mode: SummarizerPromptMode = 'full'): string {
  if (mode === 'improve') {
    return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: the user has written an Introduction for this article. Treat it as a creative seed and constraint — preserve its core claims, voice, and any specific details. Write a polished introductory paragraph (3–5 sentences, ~80 words) that expands naturally from it, adding depth from world context without contradicting the user's intent.

Rules:
- Preserve the factual core of what the user wrote
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction when ready`;
  }

  return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: read the article's ## Description section and distil it into a single Introduction paragraph (3–5 sentences, ~80 words). The Introduction goes into the World Bible — it must be self-contained, specific, and capture what makes this entity unique in the world.

Rules:
- Do not introduce new facts that aren't in the Description
- Do not use the article's title as the first word
- Write in the same tone as the world
- Call submit_introduction when ready`;
}

export function buildSummarizerUserMessage(
  articleTitle: string,
  description: string,
  mode: SummarizerPromptMode = 'full',
  existingIntro?: string,
): string {
  if (mode === 'improve' && existingIntro) {
    return `## Article: ${articleTitle}

## Existing Introduction (your seed and constraint)
${existingIntro}

## Description (for additional context)
${description}

Improve the Introduction, keeping its core claims and voice.`;
  }

  return `## Article: ${articleTitle}

## Description
${description}

Write a 1-paragraph Introduction for the World Bible derived from this Description.`;
}
