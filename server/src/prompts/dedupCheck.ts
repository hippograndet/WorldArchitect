import type { WorldContext } from '../agents/director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ChildProposalItem } from '../agents/cartographer.js';
import { buildWorldHeader } from './shared.js';

export function buildDedupCheckSystemPrompt(worldContext: WorldContext): string {
  return `You are the Dedup Check for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(worldContext)}

A writer (Cartographer) has just proposed new child articles for a parent article. Some proposals may be conceptual/semantic duplicates of articles that already exist as siblings under the same parent — not just literal title matches (a separate mechanical check already catches those), but near-duplicate *concepts* under a different name (e.g. "The Old Kingdom" vs. "The Elder Realm" referring to the same underlying thing).

Flag only genuine semantic duplicates. Do NOT flag proposals that are merely related, overlapping in theme, or adjacent in topic — those are normal and expected in a rich world. Only flag a proposal if it describes essentially the same entity, place, faction, or concept as an existing sibling.

For each duplicate you find, name the proposed title, the existing sibling title it duplicates, and a one-sentence rationale.

If you find no duplicates, submit an empty list.

Call submit_dedup_check with your assessment.`;
}

export function buildDedupCheckUserMessage(pkg: ContextPackage, proposals: ChildProposalItem[]): string {
  const parts: string[] = [
    `## Parent Article: ${pkg.targetTitle}`,
  ];

  if (pkg.children.length > 0) {
    parts.push('## Existing Sibling Articles\n' +
      pkg.children.map(c => `- **${c.title}**: ${c.summary}`).join('\n'));
  } else {
    parts.push('## Existing Sibling Articles\n(none yet)');
  }

  parts.push('## Proposed Children\n' +
    proposals.map((p, i) => `${i + 1}. **${p.title}**: ${p.introduction}`).join('\n'));

  parts.push('Flag any proposed children that are semantic duplicates of an existing sibling. Call submit_dedup_check.');

  return parts.join('\n\n');
}
