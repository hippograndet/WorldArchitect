import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader } from './shared.js';

export function buildCoherenceSystemPrompt(worldContext: WorldContext): string {
  return `You are the CoherenceAgent for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: review newly written article content against the established World Bible and context. Flag ONLY:
1. **Conflicts** (severity: 'conflict') — direct factual contradictions with something already established in the World Bible or a related article. Example: article A says character X died in Year 10, but this content says they were alive in Year 15.
2. **Warnings** (severity: 'warning') — facts that directly contradict or are incompatible with established world rules, timelines, or named entities.

Do NOT flag:
- Things that are not yet defined elsewhere (missing context, unexplained references, or "readers may not know X")
- Stylistic choices or narrative gaps
- Things that are merely surprising or unexplained

Be specific — quote the exact contradicting claim and the source article/fact it contradicts. If no actual contradiction exists, return an empty warnings array.
Suggest cross-links to articles that are directly referenced by name in the new content.

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
