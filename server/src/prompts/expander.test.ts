import { describe, it, expect } from 'vitest';
import { buildExpanderSystemPrompt, buildExpanderUserMessage } from './expander.js';

const worldInfoContext = { worldId: 'w1', title: 'Test World', introduction: 'A test world.' };
const worldContext = { worldId: 'w1', name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };

describe('Scribe scribeMode (expand_description only)', () => {
  it('"full" (default) tells Scribe to ignore any prior draft and omits it from the user message', () => {
    const system = buildExpanderSystemPrompt(worldInfoContext, worldContext, 'expand_description', 'medium');
    const user = buildExpanderUserMessage(
      'Article', 'general', 'expand_description', undefined,
      'A prior draft description that should be ignored.',
    );

    expect(system).toContain('ignore any prior draft');
    expect(user).not.toContain('A prior draft description that should be ignored.');
    expect(user).not.toContain('Existing Description');
  });

  it('"improve" tells Scribe to treat the prior draft as a seed/constraint and includes it in the user message', () => {
    const system = buildExpanderSystemPrompt(worldInfoContext, worldContext, 'expand_description', 'medium', 'improve');
    const user = buildExpanderUserMessage(
      'Article', 'general', 'expand_description', undefined,
      'A prior draft description that should be preserved.',
      undefined, undefined, undefined, 'improve',
    );

    expect(system).toContain('creative seed and constraint');
    expect(user).toContain('## Existing Description (your seed and constraint)');
    expect(user).toContain('A prior draft description that should be preserved.');
  });

  it('"improve" with no existing description omits the seed block (nothing to seed from)', () => {
    const user = buildExpanderUserMessage(
      'Article', 'general', 'expand_description', undefined, undefined,
      undefined, undefined, undefined, 'improve',
    );

    expect(user).not.toContain('Existing Description');
  });

  it('scribeMode has no effect outside expand_description (create_root never had prior content)', () => {
    const user = buildExpanderUserMessage(
      'Article', 'general', 'create_root', undefined,
      'Should never surface — create_root has no prior description.',
      undefined, undefined, undefined, 'improve',
    );

    expect(user).not.toContain('Existing Description');
  });
});
