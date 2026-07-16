export type RunStatus = 'pending' | 'running' | 'needs_input' | 'paused' | 'completed' | 'stopped' | 'failed';

export interface RunEvent {
  id: string;
  step: string;
  title: string;
  ok: boolean;
  message: string | null;
  createdAt: number;
}

export interface RunConfig {
  articleIds?: string[];
  rootArticleId?: string;
  pipelineType?: 'expand_description' | 'create_child' | 'propose_children' | 'reorganize' | 'summarize' | 'improve_intro' | 'cohere' | 'forge_expand' | 'audit' | 'concept_scan' | 'fix_issue';
  graphType?: 'expand' | 'consolidate';
  startStep?: 'inception' | 'expansion' | 'branching';
  budgetLimit?: number;
  contextDepth?: 'shallow' | 'mid' | 'deep';
  contextBasis?: 'current' | 'latest_draft' | 'published';
  branchingMode?: 'conceptual' | 'specific';
  forgeMode?: 'breadth' | 'depth';
  forgeMaxDepth?: number;
  forgeMaxChildren?: number;
  coherenceCheckLevel?: number;
  safetyNet?: boolean;
  runStylizer?: boolean;
  forgeContinuationMode?: 'one_step' | 'finish_document' | 'recursive';
  validationLevel?: 'manual' | 'assisted' | 'autopilot';
  autonomyMode?: 'manual' | 'review_each_step' | 'auto_with_post_review';
  reviewPolicy?: 'none' | 'user_must_select' | 'user_must_accept' | 'auto';
  commitPolicy?: 'no_commit' | 'pending_draft' | 'auto_commit';
  forgeInceptionExistingMode?: 'create' | 'improve' | 'replace' | 'skip_existing';
  forgeExpansionExistingMode?: 'create' | 'improve' | 'replace' | 'skip_existing';
  forgeBranchingExistingMode?: 'append_deduped' | 'skip_if_children';
}

export interface RunAgentCall {
  id: string;
  articleId: string | null;
  agentType: string;
  status: 'success' | 'error' | 'rejected' | string;
  errorMessage: string | null;
  iterations: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  pipelineType: string | null;
  createdAt: number;
}

export interface RunLlmTrace {
  id: string;
  runId: string | null;
  articleId: string | null;
  agentType: string;
  provider: string;
  iteration: number;
  status: 'success' | 'error' | string;
  request: unknown;
  response: unknown;
  errorMessage: string | null;
  createdAt: number;
}

export interface RunReviewItem {
  id: string;
  worldId: string;
  ownerId: string;
  runId: string;
  articleId: string | null;
  step: string;
  kind: 'intro_review' | 'draft_review' | 'child_selection' | 'proposal_selection' | 'idea_selection' | string;
  status: 'pending' | 'accepted' | 'rejected' | string;
  payload: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface Run {
  id: string;
  worldId: string;
  ownerId: string;
  status: RunStatus;
  graphType: string;
  checkpointId: string;
  articleIds: string[];
  budgetUsed: number;
  budgetLimit: number;
  config: RunConfig;
  errorMessage: string | null;
  itemsCompleted: number;
  itemsTotal: number;
  itemsFailed: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunWithEvents extends Run {
  events: RunEvent[];
  agentCalls: RunAgentCall[];
  reviewItems: RunReviewItem[];
}
