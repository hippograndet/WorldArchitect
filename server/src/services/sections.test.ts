import { describe, it, expect } from 'vitest';
import { splitSections, mergeSections } from './sections.js';

// ---------------------------------------------------------------------------
// splitSections
// ---------------------------------------------------------------------------

describe('splitSections', () => {
  it('returns empty strings for an empty body', () => {
    expect(splitSections('')).toEqual({ description: '', chronology: '' });
  });

  it('treats a plain body with no headings as description content', () => {
    expect(splitSections('Some plain text')).toEqual({
      description: 'Some plain text',
      chronology: '',
    });
  });

  it('returns the entire body as description when there is no Chronology heading', () => {
    // splitSections only strips the ## Description heading when BOTH headings
    // are present. With no ## Chronology, the full body (including the heading)
    // becomes the description — a known edge case callers must handle.
    const body = '## Description\n\nHello world';
    expect(splitSections(body)).toEqual({
      description: body,
      chronology: '',
    });
  });

  it('returns empty description when Chronology heading is first', () => {
    expect(splitSections('## Chronology\n\nYear 1000')).toEqual({
      description: '',
      chronology: 'Year 1000',
    });
  });

  it('extracts both sections correctly', () => {
    const body = '## Description\n\nHello world\n\n## Chronology\n\nYear 1000';
    expect(splitSections(body)).toEqual({
      description: 'Hello world',
      chronology: 'Year 1000',
    });
  });

  it('handles empty description with populated chronology', () => {
    const body = '## Description\n\n## Chronology\n\nYear 1000';
    expect(splitSections(body)).toEqual({
      description: '',
      chronology: 'Year 1000',
    });
  });

  it('handles populated description with empty chronology', () => {
    const body = '## Description\n\nHello world\n\n## Chronology';
    const result = splitSections(body);
    expect(result.description).toBe('Hello world');
    expect(result.chronology).toBe('');
  });

  it('handles multi-paragraph content in both sections', () => {
    const body = [
      '## Description',
      '',
      'Paragraph one.',
      '',
      'Paragraph two.',
      '',
      '## Chronology',
      '',
      'Year 1000 — battle of X.',
      '',
      'Year 1001 — treaty of Y.',
    ].join('\n');
    const result = splitSections(body);
    expect(result.description).toBe('Paragraph one.\n\nParagraph two.');
    expect(result.chronology).toBe('Year 1000 — battle of X.\n\nYear 1001 — treaty of Y.');
  });

  it('uses lastIndexOf, so only the last ## Chronology is treated as the heading', () => {
    // Simulate description text that contains a chronology-like line,
    // followed by a real ## Chronology heading.
    const body = [
      '## Description',
      '',
      'Mentions the chronology period.',
      '',
      '## Chronology',
      '',
      'Real timeline entry.',
    ].join('\n');
    const result = splitSections(body);
    expect(result.description).toBe('Mentions the chronology period.');
    expect(result.chronology).toBe('Real timeline entry.');
  });

  it('strips ## Description heading ONLY when ## Chronology is also present', () => {
    // With both headings the Description prefix is stripped from the result.
    const withChron = '## Description\n\nActual content\n\n## Chronology\n\nTimeline';
    expect(splitSections(withChron).description).not.toContain('## Description');

    // Without ## Chronology the raw body (including the heading) is returned.
    const withoutChron = '## Description\n\nActual content';
    expect(splitSections(withoutChron).description).toContain('## Description');
  });

  it('round-trips correctly through mergeSections → splitSections', () => {
    const original = { description: 'My hero', chronology: 'Born in 1200 CE.' };
    const merged = mergeSections(original.description, original.chronology);
    expect(splitSections(merged)).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// mergeSections
// ---------------------------------------------------------------------------

describe('mergeSections', () => {
  it('merges both non-empty sections into proper markdown', () => {
    const result = mergeSections('Hero of the realm', 'Year 1200 — crowned king.');
    expect(result).toBe(
      '## Description\n\nHero of the realm\n\n## Chronology\n\nYear 1200 — crowned king.',
    );
  });

  it('produces heading-only blocks when both inputs are empty', () => {
    expect(mergeSections('', '')).toBe('## Description\n\n## Chronology');
  });

  it('omits description content block when description is empty', () => {
    const result = mergeSections('', 'Year 1000');
    expect(result).toBe('## Description\n\n## Chronology\n\nYear 1000');
  });

  it('omits chronology content block when chronology is empty', () => {
    const result = mergeSections('Some desc', '');
    expect(result).toBe('## Description\n\nSome desc\n\n## Chronology');
  });

  it('trims whitespace from both inputs', () => {
    const result = mergeSections('  Hero  ', '  Timeline  ');
    expect(result).toBe('## Description\n\nHero\n\n## Chronology\n\nTimeline');
  });

  it('always produces both headings in order', () => {
    const result = mergeSections('x', 'y');
    const descIdx = result.indexOf('## Description');
    const chronIdx = result.indexOf('## Chronology');
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(chronIdx).toBeGreaterThan(descIdx);
  });
});
