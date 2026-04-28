import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';

export type ProposalMode = 'expand_description' | 'create_root' | 'create_child';

function toneDescription(tone: string): string {
  const tones: Record<string, string> = {
    narrative: 'Write in an engaging narrative style, as if for a well-crafted novel companion wiki.',
    academic: 'Write in a measured, analytical academic style, like a scholarly encyclopaedia.',
    terse: 'Write concisely and factually — minimal prose, maximum information density.',
    custom: 'Match the tone implied by the world description.',
  };
  return tones[tone] ?? tones.narrative;
}

function renderContextPackage(pkg: ContextPackage): string {
  const parts: string[] = [];

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

  return parts.join('\n\n');
}

export function buildProposalSystemPrompt(worldContext: WorldContext, mode: ProposalMode): string {
  const modeDesc =
    mode === 'create_root' || mode === 'create_child'
      ? 'You are creating a brand-new article. Propose 3 distinct creative directions for what this article could become.'
      : 'You are expanding an existing article stub. Propose 3 distinct creative directions for its Description section.';

  return `You are the ProposalAgent for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**
Tone: ${toneDescription(worldContext.tone)}${worldContext.originPoint ? `\nOrigin/Constraints: ${worldContext.originPoint}` : ''}

${modeDesc}

Each proposal must be:
- Distinct from the others — different angles, themes, or focuses
- Grounded in the world's established context (no contradictions)
- Specific, not generic
- Expressed as: a short title (3–8 words) + a ~60-word direction description

When you have read the world context and are ready, call submit_proposals with exactly 3 proposals.`;
}

export function buildProposalUserMessage(
  pkg: ContextPackage,
  userSpec?: string,
): string {
  const parts: string[] = [
    `## Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetSummary) {
    parts.push(`Current Introduction:\n${pkg.targetSummary}`);
  }

  const context = renderContextPackage(pkg);
  if (context) parts.push(`## World Context\n${context}`);

  if (userSpec) parts.push(`## User Specification\n${userSpec}`);

  parts.push('Propose 3 creative directions for this article.');

  return parts.join('\n\n');
}
