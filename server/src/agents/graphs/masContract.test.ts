import { describe, expect, it } from 'vitest';
import { articleContract, contractState, forgeRunContract, worldContract } from './masContract.js';

describe('MAS graph contract helpers', () => {
  it('marks Forge-style article proposal work as manual selection without commits', () => {
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

  it('marks Forge runs as subtree-scoped expansion with configurable review semantics', () => {
    expect(forgeRunContract({
      rootArticleId: 'root-1',
      maxDepth: 2,
      autonomyMode: 'review_each_step',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })).toEqual({
      location: { type: 'subtree', rootArticleId: 'root-1', maxDepth: 2 },
      intent: 'forge',
      autonomyMode: 'review_each_step',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
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
