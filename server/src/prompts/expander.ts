import type { WorldContext } from '../agents/director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import type { IdeaItem } from '../agents/muse.js';
import type { ResearchBrief } from '../agents/scribe.js';
import { buildWorldInfoHeader, buildWorldStyleHeader, toWorldStyleContext, dataBlock } from './shared.js';

export type ExpanderMode = 'expand_description' | 'create_root' | 'create_child' | 'reorganize';

export function buildExpanderSystemPrompt(worldInfoContext: WorldInfoContext, worldContext: WorldContext, mode: ExpanderMode, wordCountPreset: 'short' | 'medium' | 'long' = 'medium', scribeMode: 'full' | 'improve' = 'full'): string {
  const LENGTH_GUIDANCE: Record<string, string> = {
    short:  '~150–200 words. 2–3 paragraphs.',
    medium: '~300–350 words. 4–5 paragraphs.',
    long:   '~500–550 words. 6–7 paragraphs.',
  };
  const lengthTarget = LENGTH_GUIDANCE[wordCountPreset] ?? LENGTH_GUIDANCE.medium;

  let modeInstructions: string;

  switch (mode) {
    case 'expand_description':
      modeInstructions = scribeMode === 'improve'
        ? `You are expanding an existing article stub that already has a draft Description. Treat the existing draft (provided below) as a creative seed and constraint — preserve its established facts and voice, and elaborate or polish it using the selected creative direction. Do not write the heading — return only the content.

Target length: ${lengthTarget} Separate ideas into distinct paragraphs with a blank line between each. Do not pad or repeat — stop when the content is complete.

The Description is a timeless encyclopedia entry for the subject. Focus on nature, significance, characteristics, relationships, constraints, and role in the world. Avoid turning the article into a timeline or sequence of events unless the user's request explicitly calls for a brief historical note.`
        : `You are expanding an existing article stub. Write its **## Description** section using the selected creative direction as your seed — ignore any prior draft; write fresh from the title, research brief, and introduction. Do not write the heading — return only the content.

Target length: ${lengthTarget} Separate ideas into distinct paragraphs with a blank line between each. Do not pad or repeat — stop when the content is complete.

The Description is a timeless encyclopedia entry for the subject. Focus on nature, significance, characteristics, relationships, constraints, and role in the world. Avoid turning the article into a timeline or sequence of events unless the user's request explicitly calls for a brief historical note.`;
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

  const outputInstruction = mode === 'create_child'
    ? 'You may use context tools to look up specific articles if needed. When you are ready to deliver your output, call the appropriate output tool — place all written content directly in the tool arguments. Do not write prose in the message body.'
    : 'You may use context tools to look up specific articles if needed. When you are ready to deliver your output, write only the final prose in the assistant message body. Do not call an output tool. Do not include the ## Description heading.';

  // All three style pairs — Scribe writes the final Description prose itself,
  // unlike Muse/Curator's angle-only work (Table 2).
  const stylePairs = toWorldStyleContext(worldContext.styleConfig);
  const worldBlock = [buildWorldInfoHeader(worldInfoContext), buildWorldStyleHeader(stylePairs)].filter(Boolean).join('\n');

  return `You are the Expander for WorldArchitect, a fiction world-building tool.

${worldBlock}

${modeInstructions}
${outputInstruction}`;
}

export function buildExpanderUserMessage(
  articleTitle: string,
  templateType: string,
  mode: ExpanderMode,
  currentIntroduction?: string,
  currentDescription?: string,
  userSpec?: string,
  selectedIdeas?: IdeaItem[],
  researchBrief?: ResearchBrief,
  scribeMode: 'full' | 'improve' = 'full',
): string {
  const parts: string[] = [
    `## Article: ${articleTitle}`,
    `Template type: ${templateType}`,
  ];

  if (currentIntroduction) {
    parts.push(`Current Introduction:\n${dataBlock('target.introduction', currentIntroduction)}`);
  }

  if (mode === 'reorganize') {
    if (currentDescription) parts.push(`## Current Description (read-only constraint)\n${dataBlock('target.description', currentDescription)}`);
  }

  if (mode === 'expand_description' && scribeMode === 'improve' && currentDescription) {
    parts.push(`## Existing Description (your seed and constraint)\n${dataBlock('target.description', currentDescription)}`);
  }

  if (selectedIdeas && selectedIdeas.length > 0) {
    parts.push(`## Themes to Incorporate\n${dataBlock('selectedIdeas', selectedIdeas)}`);
  }

  if (researchBrief) {
    parts.push(`## Research Brief\n${researchBrief}`);
  }

  if (userSpec) {
    parts.push(`## User Specification\n${dataBlock('userSpec', userSpec)}`);
  }

  const actionMap: Record<ExpanderMode, string> = {
    expand_description: 'Write the ## Description section for this article.',
    create_root: 'Write the ## Description section for this new article.',
    create_child: 'Write the ## Description section for this new child article, and provide the parentAppend text.',
    reorganize: 'Reorganize the ## Description section, preserving all facts.',
  };

  parts.push(actionMap[mode]);

  return parts.join('\n\n');
}
