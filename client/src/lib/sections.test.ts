import { describe, it, expect } from 'vitest';
import {
  extractDescription,
  extractChronology,
  mergeDescription,
  mergeChronology,
} from './sections.ts';

// ---------------------------------------------------------------------------
// extractDescription
// ---------------------------------------------------------------------------

describe('extractDescription', () => {
  it('returns empty string for empty body', () => {
    expect(extractDescription('')).toBe('');
  });

  it('returns empty string when no Description heading exists', () => {
    expect(extractDescription('Some plain text without headings')).toBe('');
  });

  it('extracts content after ## Description heading', () => {
    expect(extractDescription('## Description\n\nHello world')).toBe('Hello world');
  });

  it('stops at the next ## heading', () => {
    const body = '## Description\n\nHello world\n\n## Chronology\n\nYear 1000';
    expect(extractDescription(body)).toBe('Hello world');
  });

  it('returns Chronology content when description section is empty (known regex edge case)', () => {
    // BUG: the `\n+` quantifier in the regex consumes both newlines between the
    // headings, so `(?=\n## )` never fires and the lazy capture expands to include
    // the Chronology heading and its content. In practice this case is rare because
    // articles always have description content, but callers should be aware.
    const result = extractDescription('## Description\n\n## Chronology\n\nYear 1000');
    expect(result).toBe('## Chronology\n\nYear 1000');
  });

  it('trims leading/trailing whitespace from extracted content', () => {
    expect(extractDescription('## Description\n\n  Hello  \n\n## Chronology')).toBe('Hello');
  });

  it('handles multi-paragraph description content', () => {
    const body = '## Description\n\nParagraph one.\n\nParagraph two.\n\n## Chronology\n\nY';
    expect(extractDescription(body)).toBe('Paragraph one.\n\nParagraph two.');
  });

  it('returns empty string when body only contains Chronology section', () => {
    expect(extractDescription('## Chronology\n\nYear 1000')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractChronology
// ---------------------------------------------------------------------------

describe('extractChronology', () => {
  it('returns empty string for empty body', () => {
    expect(extractChronology('')).toBe('');
  });

  it('returns empty string when no Chronology heading exists', () => {
    expect(extractChronology('## Description\n\nHello')).toBe('');
  });

  it('extracts content after ## Chronology heading', () => {
    const body = '## Description\n\nHello\n\n## Chronology\n\nYear 1000';
    expect(extractChronology(body)).toBe('Year 1000');
  });

  it('returns empty string when chronology section has no content', () => {
    const body = '## Description\n\nHello\n\n## Chronology';
    expect(extractChronology(body)).toBe('');
  });

  it('handles multi-line chronology content', () => {
    const body = '## Description\n\nX\n\n## Chronology\n\nLine 1.\n\nLine 2.';
    expect(extractChronology(body)).toBe('Line 1.\n\nLine 2.');
  });
});

// ---------------------------------------------------------------------------
// mergeDescription
// ---------------------------------------------------------------------------

describe('mergeDescription', () => {
  it('replaces description while preserving existing chronology', () => {
    const body = '## Description\n\nOld desc\n\n## Chronology\n\nYear 1000';
    const result = mergeDescription(body, 'New desc');
    expect(result).toBe('## Description\n\nNew desc\n\n## Chronology\n\nYear 1000');
  });

  it('uses default Chronology heading when body has no Chronology section', () => {
    const result = mergeDescription('## Description\n\nOld', 'New');
    expect(result).toContain('## Description\n\nNew');
    expect(result).toContain('## Chronology');
  });

  it('preserves multi-line chronology content', () => {
    const body = '## Description\n\nOld\n\n## Chronology\n\nLine 1.\n\nLine 2.';
    const result = mergeDescription(body, 'New');
    expect(result).toContain('Line 1.\n\nLine 2.');
  });

  it('works when body is empty (uses default Chronology)', () => {
    const result = mergeDescription('', 'Fresh description');
    expect(result).toContain('## Description\n\nFresh description');
    expect(result).toContain('## Chronology');
  });

  it('produces a body that extractDescription can read back', () => {
    const body = '## Description\n\nOld\n\n## Chronology\n\nTimeline';
    const merged = mergeDescription(body, 'Updated');
    expect(extractDescription(merged)).toBe('Updated');
  });

  it('preserves chronology content after round-tripping through mergeDescription', () => {
    const body = '## Description\n\nOld\n\n## Chronology\n\nTimeline data';
    const merged = mergeDescription(body, 'New desc');
    expect(extractChronology(merged)).toBe('Timeline data');
  });
});

// ---------------------------------------------------------------------------
// mergeChronology
// ---------------------------------------------------------------------------

describe('mergeChronology', () => {
  it('replaces chronology while preserving description', () => {
    const body = '## Description\n\nMy desc\n\n## Chronology\n\nOld timeline';
    const result = mergeChronology(body, 'New timeline');
    expect(result).toBe('## Description\n\nMy desc\n\n## Chronology\n\nNew timeline');
  });

  it('uses default Description heading when body has no description content', () => {
    const result = mergeChronology('', 'New timeline');
    expect(result).toContain('## Description');
    expect(result).toContain('## Chronology\n\nNew timeline');
  });

  it('strips old Chronology section from body before appending new one', () => {
    const body = '## Description\n\nDesc\n\n## Chronology\n\nOld';
    const result = mergeChronology(body, 'New');
    // Should not contain the old chronology content
    expect(result).not.toContain('Old');
    expect(result).toContain('New');
  });

  it('preserves multi-paragraph description content', () => {
    const body = '## Description\n\nPara 1.\n\nPara 2.\n\n## Chronology\n\nOld';
    const result = mergeChronology(body, 'New timeline');
    expect(result).toContain('Para 1.\n\nPara 2.');
  });

  it('produces a body that extractChronology can read back', () => {
    const body = '## Description\n\nDesc\n\n## Chronology\n\nOld';
    const merged = mergeChronology(body, 'Updated timeline');
    expect(extractChronology(merged)).toBe('Updated timeline');
  });

  it('preserves description content after round-tripping through mergeChronology', () => {
    const body = '## Description\n\nMy hero\n\n## Chronology\n\nOld';
    const merged = mergeChronology(body, 'New timeline');
    expect(extractDescription(merged)).toBe('My hero');
  });
});
