import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader } from './shared.js';

export function buildChroniclerSystemPrompt(worldContext: WorldContext): string {
  return `You are the Chronicler for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

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

  if (pkg.targetIntroduction) {
    parts.push(`**Introduction:**\n${pkg.targetIntroduction}`);
  }

  if (pkg.targetDescription) {
    parts.push(`**Current Description:**\n${pkg.targetDescription}`);
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
