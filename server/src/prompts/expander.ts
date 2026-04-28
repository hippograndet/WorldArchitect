import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ProposalItem } from '../agents/proposal.js';

export type ExpanderMode = 'expand_description' | 'create_root' | 'create_child' | 'reorganize';

function toneDescription(tone: string): string {
  const tones: Record<string, string> = {
    narrative: 'Write in an engaging narrative style, as if for a well-crafted novel companion wiki.',
    academic: 'Write in a measured, analytical academic style, like a scholarly encyclopaedia.',
    terse: 'Write concisely and factually — minimal prose, maximum information density.',
    custom: 'Match the tone implied by the world description.',
  };
  return tones[tone] ?? tones.narrative;
}

function renderContextPackage(pkg: ContextPackage, mode: ExpanderMode): string {
  const parts: string[] = [];

  if (mode === 'reorganize') {
    parts.push(`## Current Article Body (read-only constraint)\n${pkg.targetBody}`);
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

  return parts.join('\n\n');
}

export function buildExpanderSystemPrompt(worldContext: WorldContext, mode: ExpanderMode): string {
  let modeInstructions: string;

  switch (mode) {
    case 'expand_description':
      modeInstructions = `You are expanding an existing article stub. Write its **## Description** section (3–5 paragraphs) using the selected creative direction as your seed. Do not write the heading — return only the content.

The Description is a deep, thematic overview of the subject. It is not chronological — events and developments belong in the separate ## Chronology section. Focus on nature, significance, characteristics, relationships, and role in the world.`;
      break;

    case 'create_root':
      modeInstructions = `You are creating a new root article (no parent). Write its **## Description** section (3–5 paragraphs) using the selected creative direction as your seed. Do not write the heading — return only the content.

Make this article feel like a genuine, specific entity in the world. Establish its nature, significance, and position in the world clearly.`;
      break;

    case 'create_child':
      modeInstructions = `You are creating a new child article under an existing parent. Write:
1. The child's **## Description** section (3–5 paragraphs) — call submit_child_description with childDescription
2. A short **parentAppend** paragraph (1–2 sentences) that can be appended to the parent article acknowledging this new child

The child should feel like a natural, specific sub-entity or sub-topic of the parent. Do not contradict the parent's established facts.`;
      break;

    case 'reorganize':
      modeInstructions = `You are reorganizing an existing article's Description. The current full article body is provided as a read-only constraint — you must preserve ALL factual content. You may:
- Reorder paragraphs for better flow
- Split or merge paragraphs
- Improve sentence structure and clarity
- Remove redundancy

You must NOT add new facts or remove existing ones. Return only the reorganized ## Description content (no heading).`;
      break;
  }

  return `You are the Expander for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**
Tone: ${toneDescription(worldContext.tone)}${worldContext.originPoint ? `\nOrigin/Constraints: ${worldContext.originPoint}` : ''}

${modeInstructions}

You may use context tools to look up specific articles if needed. When ready, call the appropriate output tool.`;
}

export function buildExpanderUserMessage(
  pkg: ContextPackage,
  mode: ExpanderMode,
  selectedProposal?: ProposalItem,
  userSpec?: string,
): string {
  const parts: string[] = [
    `## Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetSummary) {
    parts.push(`Current Introduction:\n${pkg.targetSummary}`);
  }

  if (selectedProposal) {
    parts.push(`## Selected Creative Direction\n**${selectedProposal.title}**\n${selectedProposal.direction}`);
  }

  if (userSpec) {
    parts.push(`## User Specification\n${userSpec}`);
  }

  const context = renderContextPackage(pkg, mode);
  if (context) parts.push(`## World Context\n${context}`);

  const actionMap: Record<ExpanderMode, string> = {
    expand_description: 'Write the ## Description section for this article.',
    create_root: 'Write the ## Description section for this new article.',
    create_child: 'Write the ## Description section for this new child article, and provide the parentAppend text.',
    reorganize: 'Reorganize the ## Description section, preserving all facts.',
  };

  parts.push(actionMap[mode]);

  return parts.join('\n\n');
}
