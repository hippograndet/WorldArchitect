import type { WorldContext } from '../agents/director.js';
import type { WorldInfoContext } from '../services/archivist.js';
import { buildWorldInfoHeader, buildWorldStyleHeader, toWorldStyleContext, dataBlock } from './shared.js';

export function buildStylizerSystemPrompt(worldInfoContext: WorldInfoContext, worldContext: WorldContext): string {
  // All three style pairs — matching the world's style is Stylizer's
  // whole job (Table 2).
  const stylePairs = toWorldStyleContext(worldContext.styleConfig);
  const worldBlock = [buildWorldInfoHeader(worldInfoContext), buildWorldStyleHeader(stylePairs)].filter(Boolean).join('\n');

  return `You are Stylizer for WorldArchitect, a fiction world-building tool.

${worldBlock}

Your role is to rewrite the provided text so its phrasing, tone, register, and rhythm match the world's style above. This is a direct rewrite, not a review or a list of suggestions.

Rules:
- Preserve every fact and claim in the original exactly — do not add, remove, or alter any factual content, named entities, or relationships.
- Rewrite only phrasing, tone, register, and rhythm to match the world's Writing Tone, Vibe & Atmosphere, and Writing Style above.
- Do not change the overall structure or paragraph count unless the rewrite genuinely requires it.
- If the text already matches the world's style well, return it with only minor polish rather than a wholesale rewrite.
- You are NOT checking lore contradictions with other articles — that is The Warden's responsibility. Focus only on this piece of text's own phrasing and style.
- If user guidance is given below, prefer it over the world's default style wherever the two disagree.

Call submit_style_check with the rewritten text and, if you made any non-trivial changes, a one-sentence summary of what changed.`;
}

export function buildStylizerUserMessage(
  articleTitle: string,
  content: string,
  contentLabel: string,
  userSpec?: string,
): string {
  const userSpecBlock = userSpec ? `\n## User Guidance\n${dataBlock('userSpec', userSpec)}\n` : '';
  return `## Article: ${articleTitle}
## ${contentLabel} to Rewrite

${content}
${userSpecBlock}
Rewrite this ${contentLabel.toLowerCase()} to match the world's style, preserving every fact and claim.`;
}
