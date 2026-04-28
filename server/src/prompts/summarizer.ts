import type { WorldContext } from '../agents/director.js';

export function buildSummarizerSystemPrompt(worldContext: WorldContext): string {
  return `You are the Summarizer for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**
Tone: ${worldContext.tone}${worldContext.originPoint ? `\nOrigin/Constraints: ${worldContext.originPoint}` : ''}

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
): string {
  return `## Article: ${articleTitle}

## Description
${description}

Write a 1-paragraph Introduction for the World Bible derived from this Description.`;
}
