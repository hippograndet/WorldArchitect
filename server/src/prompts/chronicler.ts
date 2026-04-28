import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';

function toneDescription(tone: string): string {
  const tones: Record<string, string> = {
    narrative: 'Write in an engaging narrative style, as if for a well-crafted novel companion wiki.',
    academic: 'Write in a measured, analytical academic style, like a scholarly encyclopaedia.',
    terse: 'Write concisely and factually — minimal prose, maximum information density.',
    custom: 'Match the tone implied by the world description.',
  };
  return tones[tone] ?? tones.narrative;
}

export function buildChroniclerSystemPrompt(worldContext: WorldContext): string {
  return `You are the Chronicler for WorldArchitect, a fiction world-building tool.

World: **${worldContext.name}**
Tone: ${toneDescription(worldContext.tone)}${worldContext.originPoint ? `\nOrigin/Constraints: ${worldContext.originPoint}` : ''}

Your task: write the **## Chronology** section for an article. The Chronology is a list of events in chronological order — distinct from the Description, which covers thematic overview.

Guidelines:
- Each entry should be a dated or sequenced event relevant to this article's subject.
- Draw on the article's Description and its Subjects (child articles) for raw material.
- Use temporal neighbour articles to place events in the broader world timeline.
- Do not repeat information already in the Description — the Chronology complements it.
- Return only the content, no heading. Use a consistent format: date/period followed by description.

You may use context tools to look up specific articles. When ready, call submit_chronology.`;
}

export function buildChroniclerUserMessage(
  pkg: ContextPackage,
  userSpec?: string,
): string {
  const parts: string[] = [
    `## Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetSummary) {
    parts.push(`**Introduction:**\n${pkg.targetSummary}`);
  }

  // Description is in the body — extract the Description section for context
  const descMatch = pkg.targetBody.match(/## Description\s*([\s\S]*?)(?=\n## |$)/);
  const description = descMatch?.[1]?.trim() ?? '';
  if (description) {
    parts.push(`**Current Description:**\n${description}`);
  }

  if (pkg.children.length > 0) {
    parts.push(
      '## Subjects (Child Articles)\n' +
        pkg.children.map((c) => `- **${c.title}**: ${c.summary}`).join('\n'),
    );
  }

  if (pkg.temporalNeighbors.length > 0) {
    parts.push(
      '## Temporal Neighbours\n' +
        pkg.temporalNeighbors
          .map((t) => `- **${t.title}** (${t.temporalAnchorStart}): ${t.summary}`)
          .join('\n'),
    );
  }

  if (pkg.parents.length > 0) {
    parts.push(
      '## Parent Articles\n' +
        pkg.parents.map((p) => `### ${p.title}\n${p.summary}`).join('\n\n'),
    );
  }

  if (pkg.fixedPoints.length > 0) {
    parts.push(
      '## Fixed Points (World Constants)\n' +
        pkg.fixedPoints.map((f) => `### ${f.title}\n${f.summary}`).join('\n\n'),
    );
  }

  if (userSpec) {
    parts.push(`## User Specification\n${userSpec}`);
  }

  parts.push('Write the ## Chronology section for this article.');

  return parts.join('\n\n');
}
