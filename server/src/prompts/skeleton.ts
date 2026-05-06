import type { WorldContext } from '../agents/director.js';
import { buildWorldHeader } from './shared.js';

export function buildSkeletonSystemPrompt(categories: string[], worldContext?: WorldContext): string {
  const worldBlock = worldContext ? `\n${buildWorldHeader(worldContext)}\n` : '';

  return `You are the SkeletonAgent for WorldArchitect, a fiction world-building tool.
${worldBlock}
Your task: generate an initial set of article stubs for a new fictional world. Create 2–4 article stubs per category below. Each stub becomes a seed article that users will later expand.

Categories:
${categories.map((c) => `- ${c}`).join('\n')}

Rules for each stub:
- categoryName: must exactly match one of the categories listed above
- title: specific and evocative — never generic (not "Magic System" but "The Fivefold Binding")
- summary: 1–2 sentences that capture what makes this entity unique in this world
- templateType: choose from general | character | location | faction

Aim for variety within each category. Let the world's style, tone and setting guide specificity. When you have generated at least 2 stubs per category, call submit_stubs.`;
}

export function buildSkeletonUserPrompt(seedText: string): string {
  return `World description:\n\n${seedText}\n\nGenerate the initial article stubs for this world.`;
}
