import { describe, expect, it } from 'vitest';
import { sideChannelFromWarden, sideChannelFromAuditor, sideChannelFromSentinel } from './director.js';
import type { WardenOutput } from './warden.js';
import type { AuditOutput } from './director.js';
import type { SentinelOutput } from './sentinel.js';

describe('sideChannelFromWarden', () => {
  it('maps warnings and drops suggested links with no resolved target id', () => {
    const output: WardenOutput = {
      warnings: [{ severity: 'conflict', description: 'contradicts prior lore', sourceArticleId: 'art-2' }],
      suggestedLinks: [
        { targetArticleTitle: 'Resolved Article', targetArticleId: 'art-3' },
        { targetArticleTitle: 'Unresolved Article', targetArticleId: null },
      ],
    };

    const sideChannel = sideChannelFromWarden('art-1', output);

    expect(sideChannel.coherenceWarnings).toEqual([
      { severity: 'conflict', description: 'contradicts prior lore', involvedArticleIds: ['art-2'] },
    ]);
    expect(sideChannel.proposedDependencies).toEqual([
      { sourceArticleId: 'art-1', targetArticleId: 'art-3', dependencyType: 'reference' },
    ]);
  });
});

describe('sideChannelFromAuditor', () => {
  it('maps edge proposals to dependencyType by linkType and global warnings to coherenceWarnings', () => {
    const output: AuditOutput = {
      edgeProposals: [
        {
          sourceArticleId: 'art-1', sourceArticleTitle: 'A',
          targetArticleId: 'art-2', targetArticleTitle: 'B',
          linkType: 'hierarchical', rationale: 'A contains B',
        },
        {
          sourceArticleId: 'art-3', sourceArticleTitle: 'C',
          targetArticleId: 'art-4', targetArticleTitle: 'D',
          linkType: 'references', rationale: 'C mentions D',
        },
      ],
      globalWarnings: [
        { severity: 'warning', type: 'gap', description: 'no faction covers the eastern coast', involvedArticleIds: ['art-1'] },
      ],
      tokensIn: 0,
      tokensOut: 0,
    };

    const sideChannel = sideChannelFromAuditor(output);

    expect(sideChannel.proposedDependencies).toEqual([
      { sourceArticleId: 'art-1', targetArticleId: 'art-2', dependencyType: 'hierarchy', reason: 'A contains B' },
      { sourceArticleId: 'art-3', targetArticleId: 'art-4', dependencyType: 'reference', reason: 'C mentions D' },
    ]);
    expect(sideChannel.coherenceWarnings).toEqual([
      { severity: 'warning', description: 'no faction covers the eastern coast', involvedArticleIds: ['art-1'] },
    ]);
  });
});

describe('sideChannelFromSentinel', () => {
  it('maps critical retention issues to blocking, others to warning', () => {
    const output: SentinelOutput = {
      passed: false,
      issues: [
        { severity: 'critical', description: 'lost the founding date' },
        { severity: 'warning', description: 'tone shifted slightly' },
      ],
    };

    const sideChannel = sideChannelFromSentinel(output);

    expect(sideChannel.issues).toEqual([
      { severity: 'blocking', explanation: 'lost the founding date' },
      { severity: 'warning', explanation: 'tone shifted slightly' },
    ]);
  });
});
