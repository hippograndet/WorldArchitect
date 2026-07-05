import { describe, expect, it } from 'vitest';
import { articleContract, contractState, forgeContract, worldContract } from './masContract.js';

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

  it('marks Forge as a subtree run with automatic post-review semantics', () => {
    expect(forgeContract('root-1', 2)).toEqual({
      location: { type: 'subtree', rootArticleId: 'root-1', maxDepth: 2 },
      intent: 'forge',
      autonomyMode: 'auto_with_post_review',
      reviewPolicy: 'auto',
      commitPolicy: 'auto_commit',
    });
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
