import { describe, expect, it } from 'vitest';
import { articleContract, contractState, expandRunContract, forgeContract, worldContract } from './masContract.js';

describe('MAS graph contract helpers', () => {
  it('marks Spark-style article proposal work as manual selection without commits', () => {
    const contract = articleContract({
      articleId: 'art-1',
      intent: 'propose',
      reviewPolicy: 'user_must_select',
      commitPolicy: 'no_commit',
    });

    expect(contract).toEqual({
      location: { type: 'article', articleId: 'art-1' },
      intent: 'propose',
      autonomyMode: 'manual',
      reviewPolicy: 'user_must_select',
      commitPolicy: 'no_commit',
    });
  });

  it('marks Expand runs as subtree-scoped expansion with configurable review semantics', () => {
    expect(expandRunContract({
      rootArticleId: 'root-1',
      maxDepth: 2,
      autonomyMode: 'review_each_step',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })).toEqual({
      location: { type: 'subtree', rootArticleId: 'root-1', maxDepth: 2 },
      intent: 'expand',
      autonomyMode: 'review_each_step',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    });
  });

  it('keeps the legacy Forge contract helper as an Expand-run alias', () => {
    expect(forgeContract('root-1', 2)).toEqual(expandRunContract({ rootArticleId: 'root-1', maxDepth: 2 }));
  });

  it('materializes normalized state fields from a contract', () => {
    const contract = worldContract('audit');
    expect(contractState(contract)).toEqual({
      masContract: contract,
      masLocation: { type: 'world' },
      masIntent: 'audit',
      autonomyMode: 'manual',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'no_commit',
    });
  });
});
