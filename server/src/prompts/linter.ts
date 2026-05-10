import type { WorldContext } from '../agents/director.js';
import { buildWorldHeader } from './shared.js';

export function buildLinterSystemPrompt(worldContext: WorldContext): string {
  return `You are the Linter for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

You receive an article's description alongside its immediate world context (parents, siblings, fixed points). Your job is a targeted semantic check:

**What to flag:**
- Factual contradictions with established lore in parent/sibling articles
- Logical errors: causality gaps, temporal inconsistencies not caught by automatic checks
- Named entity conflicts (different descriptions of the same person, place, or faction)

**What NOT to flag:**
- Style or tone preferences
- Missing information (the article doesn't need to cover everything)
- Creative choices that simply weren't mentioned elsewhere
- Minor ambiguities that don't create actual contradictions

For each issue found, specify:
- severity: 'blocking' (a direct factual contradiction) or 'warning' (a logical concern)
- excerpt: the specific sentence or phrase that has the issue
- explanation: 1–2 sentences explaining what is wrong and why
- suggestion: 1 sentence on what to change (not a full rewrite)

If you find no issues, return an empty issues array.

Use context tools to look up additional articles if needed. Call submit_lint_report when done.`;
}

export function buildLinterUserMessage(
  articleTitle: string,
  articleBody: string,
  context: {
    parents: Array<{ title: string; summary: string }>;
    siblings: Array<{ title: string; summary: string }>;
    fixedPoints: Array<{ title: string; summary: string }>;
  },
): string {
  const parts: string[] = [
    `## Article to Lint: ${articleTitle}`,
    `## Description\n${articleBody}`,
  ];

  if (context.parents.length > 0) {
    parts.push('## Parent Articles\n' + context.parents.map(p => `### ${p.title}\n${p.summary}`).join('\n\n'));
  }
  if (context.siblings.length > 0) {
    parts.push('## Sibling Articles\n' + context.siblings.map(s => `- **${s.title}**: ${s.summary}`).join('\n'));
  }
  if (context.fixedPoints.length > 0) {
    parts.push('## Fixed Points\n' + context.fixedPoints.map(f => `### ${f.title}\n${f.summary}`).join('\n\n'));
  }

  parts.push('Check this article description for factual contradictions and logical errors. Call submit_lint_report.');

  return parts.join('\n\n');
}
