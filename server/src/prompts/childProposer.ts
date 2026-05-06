import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import { buildWorldHeader } from './shared.js';

export function buildChildProposerSystemPrompt(worldContext: WorldContext): string {
  return `You are the ChildProposer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

Your task: given an existing article's Description and its current sub-articles (Subjects), propose 10 new child article concepts that would naturally belong under this article.

Each proposal must be:
- A title that fits the requested mode (see below)
- A 1-paragraph Introduction that would go into the World Bible
- The appropriate template type: general | character | location | faction
- Distinct from existing sub-articles (do not duplicate them)
- Consistent with the parent's established facts

**Conceptual vs Instance mode** (check the User Specification):
- If the spec requests "conceptual domain categories": propose top-level organising articles (Technology, Religion, Geography, Nations, Culture, Economy, Magic System, Law, etc.). Title each as "[Parent Title] [Domain]" — e.g. "Kingdom of Arath Religion", "Kingdom of Arath Geography". Use bare domain names only if the parent is the world root article.
- If the spec requests "specific instances": propose concrete, named entities — individual people, places, groups, artefacts, or events that exist in the world.
- If no mode is specified, mix both as appropriate to the parent context.

Call submit_child_proposals when ready.`;
}

export function buildChildProposerUserMessage(
  pkg: ContextPackage,
  userSpec?: string,
): string {
  const parts: string[] = [
    `## Parent Article: ${pkg.targetTitle}`,
    `Template type: ${pkg.targetTemplateType}`,
  ];

  if (pkg.targetSummary) {
    parts.push(`Introduction:\n${pkg.targetSummary}`);
  }

  const { description: descContent } = (() => {
    // Extract description from body if available
    const body = pkg.targetBody;
    const descIdx = body.indexOf('## Description');
    const chronIdx = body.indexOf('## Chronology');
    if (descIdx === -1) return { description: body };
    const after = body.slice(descIdx + '## Description'.length).trim();
    const desc = chronIdx > descIdx
      ? body.slice(descIdx + '## Description'.length, chronIdx).trim()
      : after;
    return { description: desc };
  })();

  if (descContent) {
    parts.push(`## Description\n${descContent}`);
  }

  if (pkg.children.length > 0) {
    parts.push('## Existing Sub-Articles (do not duplicate)\n' +
      pkg.children.map(c => `- **${c.title}**: ${c.summary}`).join('\n'));
  }

  if (userSpec) {
    parts.push(`## User Specification\n${userSpec}`);
  }

  parts.push('Propose 10 new child article concepts for this parent.');

  return parts.join('\n\n');
}
