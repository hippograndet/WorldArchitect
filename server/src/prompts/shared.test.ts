import { describe, it, expect } from 'vitest';
import { buildWorldInfoHeader, buildWorldStyleHeader, toWorldStyleContext } from './shared.js';

describe('toWorldStyleContext', () => {
  it('returns no pairs for a null styleConfig', () => {
    expect(toWorldStyleContext(null)).toEqual([]);
  });

  it('skips fields the user never set, keeps only the three named ones', () => {
    const pairs = toWorldStyleContext({
      preset: 'epic_fantasy',
      tonePreset: 'archivist',
      tonePresetValue: 'Some preset text',
      toneGuidance: '',
      vibePreset: 'grand',
      vibe: 'Grand and mythic.',
      writingStyle: 'Lyrical, long sentences.',
      inspirations: [{ name: 'X', expandedDescription: 'Y' }],
      constraints: 'No modern technology.',
    });

    expect(pairs).toEqual([
      { name: 'Vibe & Atmosphere', value: 'Grand and mythic.' },
      { name: 'Writing Style', value: 'Lyrical, long sentences.' },
    ]);
  });

  it('includes all three when all three are set', () => {
    const pairs = toWorldStyleContext({
      toneGuidance: 'A neutral archivist voice.',
      vibe: 'Grand and mythic.',
      writingStyle: 'Lyrical, long sentences.',
      inspirations: [],
    });

    expect(pairs.map((p) => p.name)).toEqual(['Writing Tone', 'Vibe & Atmosphere', 'Writing Style']);
  });
});

describe('buildWorldStyleHeader', () => {
  it('renders an empty string for an empty pair list', () => {
    expect(buildWorldStyleHeader([])).toBe('');
  });

  it('renders one data block per pair', () => {
    const header = buildWorldStyleHeader([
      { name: 'Vibe & Atmosphere', value: 'Grand and mythic.' },
    ]);
    expect(header).toContain('Vibe & Atmosphere');
    expect(header).toContain('Grand and mythic.');
  });
});

describe('buildWorldInfoHeader', () => {
  it('renders the root article title and introduction', () => {
    const header = buildWorldInfoHeader({
      worldId: 'world-1',
      title: 'The Sundered Realm',
      introduction: 'A shattered continent bound by old oaths.',
    });
    expect(header).toContain('The Sundered Realm');
    expect(header).toContain('A shattered continent bound by old oaths.');
  });
});
