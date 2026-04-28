import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';

export function buildCoherenceSystemPrompt(worldContext: WorldContext): string {
  return `You are the CoherenceAgent for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**
Tone: ${worldContext.tone}${worldContext.originPoint ? `\nOrigin/Constraints: ${worldContext.originPoint}` : ''}

Your task: review newly written article content against the established World Bible and context. Identify:
1. **Conflicts** — direct contradictions with established facts (severity: 'conflict')
2. **Warnings** — potential inconsistencies, anachronisms, or unclear tensions (severity: 'warning')
3. **Suggested links** — other articles this content should reference (cross-links)

Be specific — point to the exact claim that conflicts and the article it contradicts.
If there are no issues, return empty arrays.

You may use context tools to look up specific articles. Call submit_coherence_check when done.`;
}

export function buildCoherenceUserMessage(
  pkg: ContextPackage,
  newContent: string,
  contentLabel: string,
): string {
  const parts: string[] = [
    `## Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetSummary) {
    parts.push(`Introduction:\n${pkg.targetSummary}`);
  }

  parts.push(`## New ${contentLabel}\n${newContent}`);

  if (pkg.parents.length > 0) {
    parts.push('## Parent Context\n' + pkg.parents.map(p => `### ${p.title}\n${p.summary}`).join('\n\n'));
  }
  if (pkg.fixedPoints.length > 0) {
    parts.push('## Fixed Points (World Constants)\n' + pkg.fixedPoints.map(f => `### ${f.title}\n${f.summary}`).join('\n\n'));
  }
  if (pkg.temporalNeighbors.length > 0) {
    parts.push('## Temporal Neighbours\n' + pkg.temporalNeighbors.map(t => `- **${t.title}** (${t.temporalAnchorStart}): ${t.summary}`).join('\n'));
  }

  parts.push('Check this content for contradictions and suggest cross-links.');

  return parts.join('\n\n');
}
