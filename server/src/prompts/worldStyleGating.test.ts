import { describe, it, expect } from 'vitest';
import { buildResearcherSystemPrompt } from './researcher.js';
import { buildChildProposerSystemPrompt } from './childProposer.js';
import { buildArbiterSystemPrompt } from './arbiter.js';
import { buildProposalSystemPrompt } from './proposal.js';
import { buildTasteSystemPrompt } from './taste.js';
import { buildHeraldSystemPrompt } from './herald.js';
import { buildExpanderSystemPrompt } from './expander.js';
import { buildStylizerSystemPrompt } from './stylizer.js';

const worldInfoContext = { worldId: 'w1', title: 'Test World', introduction: 'A test world.' };

// A world with all three style fields set — if any of these leak into a
// prompt that Table 2 says shouldn't see them, these exact strings will
// appear in the assembled output.
const worldContext = {
  worldId: 'w1',
  name: 'Test World',
  tone: 'narrative',
  originPoint: null,
  styleConfig: {
    toneGuidance: 'UNIQUE_TONE_MARKER a neutral archivist voice',
    vibe: 'UNIQUE_VIBE_MARKER grand and mythic',
    writingStyle: 'UNIQUE_WRITINGSTYLE_MARKER lyrical prose',
    inspirations: [],
  },
};

describe('Table 2 per-agent WorldStyleContext gating', () => {
  it('Researcher gets no style text at all', () => {
    const prompt = buildResearcherSystemPrompt(worldInfoContext);
    expect(prompt).not.toContain('UNIQUE_TONE_MARKER');
    expect(prompt).not.toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).not.toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Cartographer (ChildProposer) gets no style text at all', () => {
    const prompt = buildChildProposerSystemPrompt(worldInfoContext);
    expect(prompt).not.toContain('UNIQUE_TONE_MARKER');
    expect(prompt).not.toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).not.toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Arbiter (was ContinuityEditor) gets no style text at all', () => {
    const prompt = buildArbiterSystemPrompt(worldInfoContext);
    expect(prompt).not.toContain('UNIQUE_TONE_MARKER');
    expect(prompt).not.toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).not.toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Muse (proposal) gets only Vibe & Atmosphere, never tone/writingStyle', () => {
    const prompt = buildProposalSystemPrompt(worldInfoContext, worldContext, 'expand_description');
    expect(prompt).toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).not.toContain('UNIQUE_TONE_MARKER');
    expect(prompt).not.toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Curator (taste) gets only Vibe & Atmosphere, never tone/writingStyle', () => {
    const prompt = buildTasteSystemPrompt(worldInfoContext, worldContext);
    expect(prompt).toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).not.toContain('UNIQUE_TONE_MARKER');
    expect(prompt).not.toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Herald (was Lorekeeper) gets all three style pairs', () => {
    const prompt = buildHeraldSystemPrompt(worldInfoContext, worldContext, 'full');
    expect(prompt).toContain('UNIQUE_TONE_MARKER');
    expect(prompt).toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Scribe (expander) gets all three style pairs', () => {
    const prompt = buildExpanderSystemPrompt(worldInfoContext, worldContext, 'expand_description');
    expect(prompt).toContain('UNIQUE_TONE_MARKER');
    expect(prompt).toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });

  it('Stylizer (was StyleWarden) gets all three style pairs', () => {
    const prompt = buildStylizerSystemPrompt(worldInfoContext, worldContext);
    expect(prompt).toContain('UNIQUE_TONE_MARKER');
    expect(prompt).toContain('UNIQUE_VIBE_MARKER');
    expect(prompt).toContain('UNIQUE_WRITINGSTYLE_MARKER');
  });
});
