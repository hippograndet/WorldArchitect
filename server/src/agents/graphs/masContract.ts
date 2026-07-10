import type { ExpanderMode } from '../../prompts/expander.js';
import type { ProposalMode } from '../../prompts/proposal.js';

export type MasLocation =
  | { type: 'article'; articleId: string }
  | { type: 'subtree'; rootArticleId: string; maxDepth: number }
  | { type: 'world' };

export type MasIntent =
  | 'create_world'
  | 'propose'
  | 'ideate'
  | 'expand'
  | 'summarize'
  | 'branch'
  | 'reorganize'
  | 'cohere'
  | 'compress'
  | 'audit'
  | 'research';

export type AutonomyMode = 'manual' | 'review_each_step' | 'auto_with_post_review';
export type ReviewPolicy = 'none' | 'user_must_select' | 'user_must_accept' | 'auto';
export type CommitPolicy = 'no_commit' | 'pending_draft' | 'auto_commit';

export interface MasContract {
  location: MasLocation;
  intent: MasIntent;
  autonomyMode: AutonomyMode;
  reviewPolicy: ReviewPolicy;
  commitPolicy: CommitPolicy;
}

export function contractState(contract: MasContract): {
  masContract: MasContract;
  masLocation: MasLocation;
  masIntent: MasIntent;
  autonomyMode: AutonomyMode;
  reviewPolicy: ReviewPolicy;
  commitPolicy: CommitPolicy;
} {
  return {
    masContract: contract,
    masLocation: contract.location,
    masIntent: contract.intent,
    autonomyMode: contract.autonomyMode,
    reviewPolicy: contract.reviewPolicy,
    commitPolicy: contract.commitPolicy,
  };
}

export function articleContract(params: {
  articleId: string;
  intent: MasIntent;
  reviewPolicy?: ReviewPolicy;
  commitPolicy?: CommitPolicy;
  autonomyMode?: AutonomyMode;
}): MasContract {
  return {
    location: { type: 'article', articleId: params.articleId },
    intent: params.intent,
    autonomyMode: params.autonomyMode ?? 'manual',
    reviewPolicy: params.reviewPolicy ?? 'user_must_accept',
    commitPolicy: params.commitPolicy ?? 'no_commit',
  };
}

export function worldContract(intent: Extract<MasIntent, 'create_world' | 'audit' | 'compress'>): MasContract {
  return {
    location: { type: 'world' },
    intent,
    autonomyMode: 'manual',
    reviewPolicy: 'user_must_accept',
    commitPolicy: 'no_commit',
  };
}

export function expandRunContract(params: {
  rootArticleId: string;
  maxDepth: number;
  autonomyMode?: AutonomyMode;
  reviewPolicy?: ReviewPolicy;
  commitPolicy?: CommitPolicy;
}): MasContract {
  return {
    location: { type: 'subtree', rootArticleId: params.rootArticleId, maxDepth: params.maxDepth },
    intent: 'expand',
    autonomyMode: params.autonomyMode ?? 'auto_with_post_review',
    reviewPolicy: params.reviewPolicy ?? 'auto',
    commitPolicy: params.commitPolicy ?? 'auto_commit',
  };
}

/** @deprecated Use expandRunContract. Kept for compatibility while UI/store names are cleaned up. */
export function forgeContract(rootArticleId: string, maxDepth: number): MasContract {
  return expandRunContract({ rootArticleId, maxDepth });
}

export function proposalIntent(_mode: ProposalMode): MasIntent {
  return 'propose';
}

export function expanderIntent(mode: ExpanderMode): MasIntent {
  return mode === 'reorganize' ? 'reorganize' : 'expand';
}
