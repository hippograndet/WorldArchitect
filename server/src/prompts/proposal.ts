import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader } from './shared.js';

export type ProposalMode = 'expand_description' | 'create_root' | 'create_child';

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
      ? 'You are creating a brand-new article. Propose 3 distinct creative identities for what this entity fundamentally IS.'
      : 'You are expanding an existing article stub. Propose 3 distinct creative identities for what this entity fundamentally IS.';

  return `You are the ProposalAgent for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

${modeDesc}

Each proposal defines what this entity fundamentally IS — its nature, character, essence, atmosphere, and place in the world — from a distinct creative angle. These are NOT structural focuses, writing outlines, or section breakdowns.

GOOD example: "A vast ocean planet with scattered volcanic archipelagos, dominated by bioluminescent megafauna and inhabited by nomadic sea-tribes who navigate by the creatures' light patterns." — this is what the entity IS.
BAD example: "Explore the marine ecosystem of Planet Blue Sea" — this is a writing instruction, not an identity.

Each proposal must be:
- A distinct creative identity — different natures, not different angles on the same nature
- Grounded in the world's established context (no contradictions)
- Specific, not generic
- Expressed as: a short title (3–8 words) + a ~60-word description of what the entity IS

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

  if (pkg.targetIntroduction) {
    parts.push(`Current Introduction:\n${pkg.targetIntroduction}`);
  }

  const context = renderContextPackage(pkg);
  if (context) parts.push(`## World Context\n${context}`);

  if (userSpec) parts.push(`## User Specification\n${userSpec}`);

  parts.push('Propose 3 creative identities for this entity — what it fundamentally IS, not how to write about it.');

  return parts.join('\n\n');
}
