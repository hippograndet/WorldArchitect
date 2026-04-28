import type { WorldContext } from '../agents/director.js';

export function buildRetentionSystemPrompt(worldContext: WorldContext): string {
  return `You are the RetentionAgent for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**

Your task: compare the original article content (before reorganization) with the reorganized version. Verify that ALL facts from the original are preserved in the new version.

A fact is considered lost if:
- It is entirely absent from the reorganized version
- Its meaning was materially distorted

Mark issues as 'critical' if a key fact is completely gone, or 'warning' if a fact is present but imprecisely stated. If everything is retained, return passed=true and an empty issues array.

Call submit_retention_check when done.`;
}

export function buildRetentionUserMessage(
  articleTitle: string,
  originalBody: string,
  reorganizedDescription: string,
): string {
  return `## Article: ${articleTitle}

## Original Content (before reorganization)
${originalBody}

## Reorganized Description (after reorganization)
${reorganizedDescription}

Verify that all facts from the original are present in the reorganized version.`;
}
