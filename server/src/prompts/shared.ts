import type { WorldContext } from '../agents/director.js';

export function toneDescription(tone: string): string {
  const tones: Record<string, string> = {
    narrative: 'Write in an engaging narrative style, as if for a well-crafted novel companion wiki.',
    academic:  'Write in a measured, analytical academic style, like a scholarly encyclopaedia.',
    terse:     'Write concisely and factually — minimal prose, maximum information density.',
    custom:    'Match the tone implied by the world description.',
  };
  return tones[tone] ?? tones.narrative;
}

/**
 * Renders the world header block injected into every agent system prompt.
 * Includes name, tone, and all style fields when present.
 */
export function buildWorldHeader(world: WorldContext): string {
  const lines: string[] = [
    `World: **${world.name}**`,
    `Tone: ${toneDescription(world.tone)}`,
  ];

  if (world.styleConfig) {
    const { vibe, writingStyle, inspirations, constraints } = world.styleConfig;
    if (vibe)         lines.push(`Vibe & Atmosphere: ${vibe}`);
    if (writingStyle) lines.push(`Writing Style: ${writingStyle}`);
    for (const ins of (inspirations ?? [])) {
      lines.push(`Inspiration — ${ins.name}:\n${ins.expandedDescription}`);
    }
    if (constraints)  lines.push(`Constraints: ${constraints}`);
  } else if (world.originPoint) {
    lines.push(`Origin/Constraints: ${world.originPoint}`);
  }

  return lines.join('\n');
}
