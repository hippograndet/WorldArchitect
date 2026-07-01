import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ProposalItem } from '../agents/muse.js';
import type { IdeaItem } from '../agents/oracle.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldHeader, dataBlock } from './shared.js';

export type ExpanderMode = 'expand_description' | 'create_root' | 'create_child' | 'reorganize';

function renderContextPackage(pkg: ContextPackage, mode: ExpanderMode): string {
  const parts: string[] = [];

  if (mode === 'reorganize') {
    if (pkg.targetDescription) parts.push(`## Current Description (read-only constraint)\n${dataBlock('target.description', pkg.targetDescription)}`);
    if (pkg.targetChronology)  parts.push(`## Current Chronology (read-only constraint)\n${dataBlock('target.chronology', pkg.targetChronology)}`);
  }

  if (pkg.parents.length > 0) {
    parts.push('## Parent Articles\n' + dataBlock('context.parents', pkg.parents));
  }
  if (pkg.siblings.length > 0) {
    parts.push('## Sibling Articles\n' + dataBlock('context.siblings', pkg.siblings));
  }
  if (pkg.children.length > 0) {
    parts.push('## Existing Sub-Articles\n' + dataBlock('context.children', pkg.children));
  }
  if (pkg.fixedPoints.length > 0) {
    parts.push('## Fixed Points (World Constants)\n' + dataBlock('context.fixedPoints', pkg.fixedPoints));
  }
  if (pkg.temporalNeighbors.length > 0) {
    parts.push('## Temporal Neighbours\n' + dataBlock('context.temporalNeighbors', pkg.temporalNeighbors));
  }
  if (pkg.referencedArticles.length > 0) {
    parts.push('## Referenced Articles\n' + pkg.referencedArticles.map(r => `- ${r.title}`).join('\n'));
  }

  return parts.join('\n\n');
}

export function buildExpanderSystemPrompt(worldContext: WorldContext, mode: ExpanderMode, wordCountPreset: 'short' | 'medium' | 'long' = 'medium'): string {
  const LENGTH_GUIDANCE: Record<string, string> = {
    short:  '~150–200 words. 2–3 paragraphs.',
    medium: '~300–350 words. 4–5 paragraphs.',
    long:   '~500–550 words. 6–7 paragraphs.',
  };
  const lengthTarget = LENGTH_GUIDANCE[wordCountPreset] ?? LENGTH_GUIDANCE.medium;

  let modeInstructions: string;

  switch (mode) {
    case 'expand_description':
      modeInstructions = `You are expanding an existing article stub. Write its **## Description** section using the selected creative direction as your seed. Do not write the heading — return only the content.

Target length: ${lengthTarget} Separate ideas into distinct paragraphs with a blank line between each. Do not pad or repeat — stop when the content is complete.

The Description is a thematic overview of the subject. It is not chronological — events belong in the separate ## Chronology section. Focus on nature, significance, characteristics, relationships, and role in the world.`;
      break;

    case 'create_root':
      modeInstructions = `You are creating a new root article (no parent). Write its **## Description** section using the selected creative direction as your seed. Do not write the heading — return only the content.

Target length: ${lengthTarget} Separate ideas into distinct paragraphs with a blank line between each. Do not pad or repeat — stop when the content is complete.

Make this article feel like a genuine, specific entity in the world. Establish its nature, significance, and position clearly.`;
      break;

    case 'create_child':
      modeInstructions = `You are creating a new child article stub under an existing parent. Write:
1. A short seed paragraph (~80 words) describing what this entity fundamentally IS — its nature, character, and role in the world. This will become the article's Introduction. Call submit_child_description with this as childDescription.
2. A short **parentAppend** (1–2 sentences) to append to the parent article acknowledging this new child.

Do NOT write a full Description — the user will expand the child article separately. Focus only on establishing what the entity is at its core. Do not contradict the parent's established facts.`;
      break;

    case 'reorganize':
      modeInstructions = `You are reorganizing an existing article's Description. The current full article body is provided as a read-only constraint — you must preserve ALL factual content. You may:
- Reorder paragraphs for better flow
- Split or merge paragraphs
- Improve sentence structure and clarity
- Remove redundancy

You must NOT add new facts or remove existing ones. Return only the reorganized ## Description content (no heading). Target length: ${lengthTarget} Separate ideas into distinct paragraphs with a blank line between each. Do not pad or repeat — stop when the content is complete.`;
      break;
  }

  const mentionInstruction = mode === 'reorganize' ? '' : `
**Entity mentions**: If your description coins a brand-new entity — a character, location, or faction that you invented and that does not appear anywhere in the world context above — list it in the optional \`mentions\` field. Do NOT include: the article's parent, siblings, ancestors, or any entity already named in the provided world context. Only genuinely novel creations that are central to this article belong here. For each, provide the template type and a one-sentence summary.`;

  return `You are the Expander for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

${modeInstructions}
${mentionInstruction}
You may use context tools to look up specific articles if needed. When you are ready to deliver your output, call the appropriate output tool — place all written content directly in the tool arguments. Do not write prose in the message body.`;
}

export function buildExpanderUserMessage(
  pkg: ContextPackage,
  mode: ExpanderMode,
  selectedProposal?: ProposalItem,
  userSpec?: string,
  selectedIdeas?: IdeaItem[],
  researchBrief?: ResearchBrief,
): string {
  const parts: string[] = [
    `## Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetIntroduction) {
    parts.push(`Current Introduction:\n${dataBlock('target.introduction', pkg.targetIntroduction)}`);
  }

  if (selectedProposal) {
    parts.push(`## Selected Creative Direction\n${dataBlock('selectedProposal', selectedProposal)}`);
  }

  if (selectedIdeas && selectedIdeas.length > 0) {
    parts.push(`## Themes to Incorporate\n${dataBlock('selectedIdeas', selectedIdeas)}`);
  }

  if (researchBrief) {
    const briefParts: string[] = [];
    if (researchBrief.keyFacts.length > 0) {
      briefParts.push(`**Established facts to respect:**\n${researchBrief.keyFacts.map(f => `- ${f}`).join('\n')}`);
    }
    if (researchBrief.warnings.length > 0) {
      briefParts.push(`**Watch out for:**\n${researchBrief.warnings.map(w => `- ${w}`).join('\n')}`);
    }
    if (researchBrief.suggestedAngles.length > 0) {
      briefParts.push(`**Angles worth developing:**\n${researchBrief.suggestedAngles.map(a => `- ${a}`).join('\n')}`);
    }
    if (briefParts.length > 0) parts.push(`## Research Brief\n${briefParts.join('\n\n')}`);
  }

  if (userSpec) {
    parts.push(`## User Specification\n${dataBlock('userSpec', userSpec)}`);
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
