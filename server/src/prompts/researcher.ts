import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader } from './shared.js';

export function buildResearcherSystemPrompt(worldContext: WorldContext): string {
  return `You are the Researcher for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your job is a dedicated research pass before any writing occurs. You will receive an article's context package — parents, siblings, children, fixed points, temporal neighbours, and referenced articles.

Read the provided context carefully. Extract the established facts that any description of this article MUST respect. Think in terms of:
- Named relationships (who is connected to whom, and how)
- Geographic anchors (where things are located relative to each other)
- Temporal facts (dates, eras, sequences of events)
- Causal chains (what caused what)
- Stated contradictions or inconsistencies already present that the writer should avoid compounding

Your output has three fields:
1. **keyFacts** (5–10 items): concrete, specific facts already established in the world. Each should be a complete sentence a writer can check against.
2. **warnings** (0–3 items): specific "watch out for" notes — known tensions, edge cases, or partial contradictions the writer should be aware of.
3. **suggestedAngles** (1–3 items): thematic threads or unexplored aspects worth developing, derived from what the context suggests is missing or underdeveloped.

Do NOT invent. Do NOT speculate. List only what is already established in the provided context — or what is conspicuously absent (for warnings/angles).

Use context tools to look up additional articles if needed. When done, call submit_research_brief.`;
}

export function buildResearcherUserMessage(pkg: ContextPackage): string {
  const parts: string[] = [
    `## Article to Research: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetIntroduction) {
    parts.push(`Current Introduction:\n${pkg.targetIntroduction}`);
  }

  if (pkg.parents.length > 0) {
    parts.push('## Parent Articles\n' + pkg.parents.map(p => `### ${p.title}\n${p.summary}`).join('\n\n'));
  }
  if (pkg.siblings.length > 0) {
    parts.push('## Sibling Articles\n' + pkg.siblings.map(s => `- **${s.title}**: ${s.summary}`).join('\n'));
  }
  if (pkg.children.length > 0) {
    parts.push('## Existing Sub-Articles\n' + pkg.children.map(c => `- **${c.title}**: ${c.summary}`).join('\n'));
  }
  if (pkg.fixedPoints.length > 0) {
    parts.push('## Fixed Points (World Constants)\n' + pkg.fixedPoints.map(f => `### ${f.title}\n${f.summary}`).join('\n\n'));
  }
  if (pkg.temporalNeighbors.length > 0) {
    parts.push('## Temporal Neighbours\n' + pkg.temporalNeighbors.map(t => `- **${t.title}** (${t.temporalAnchorStart}): ${t.summary}`).join('\n'));
  }
  if (pkg.referencedArticles.length > 0) {
    parts.push('## Referenced Articles\n' + pkg.referencedArticles.map(r => `- ${r.title}`).join('\n'));
  }

  parts.push('Extract the established facts, warnings, and suggested angles for this article. Call submit_research_brief when ready.');

  return parts.join('\n\n');
}
