import type { ContextPackage, WorldInfoContext } from '../services/archivist.js';
import { buildWorldInfoHeader } from './shared.js';

export function buildResearcherSystemPrompt(worldInfoContext: WorldInfoContext): string {
  return `You are the Researcher for WorldArchitect, a fiction world-building tool.

${buildWorldInfoHeader(worldInfoContext)}

Your job is a dedicated research pass before any writing occurs. You will receive an article's context package — parents, siblings, children, fixed points, and referenced articles.

Read the provided context carefully. Extract the established facts that any description of this article MUST respect. Think in terms of:
- Named relationships (who is connected to whom, and how)
- Geographic anchors (where things are located relative to each other)
- Defining properties, roles, rules, and constraints
- Causal or conceptual relationships where they are already established
- Stated contradictions or inconsistencies already present that the writer should avoid compounding

Write your findings as a single flowing research brief (roughly 100–1200 characters) — not a list. Cover, in prose:
- The established facts (concrete, checkable) any description of this article MUST respect
- Any watch-out-for tensions, known contradictions, or edge cases the writer should be aware of
- Thematic threads or unexplored angles worth developing, where the context suggests something missing or underdeveloped

Weave these together naturally — a detail can be both a fact and a caution; don't force it into a rigid category.

Do NOT invent. Do NOT speculate. Write only what is already established in the provided context — or what is conspicuously absent (for tensions/angles).

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
  if (pkg.referencedArticles.length > 0) {
    parts.push('## Referenced Articles\n' + pkg.referencedArticles.map(r => `- ${r.title}`).join('\n'));
  }

  parts.push('Write the research brief for this article as flowing prose. Call submit_research_brief when ready.');

  return parts.join('\n\n');
}
