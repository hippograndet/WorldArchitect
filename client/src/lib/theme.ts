import type { World, VisualTheme } from '../types/world.ts';

export function resolveTheme(world: World | null | undefined): VisualTheme {
  const manual = world?.styleConfig?.visualTheme;
  if (manual && manual !== 'default') return manual;
  const preset = world?.styleConfig?.preset;
  if (preset === 'epic_fantasy') return 'arcane_scroll';
  if (preset === 'space_opera') return 'data_link';
  if (preset === 'gritty_realism' || preset === 'cosmic_horror') return 'dossier';
  return 'default';
}
