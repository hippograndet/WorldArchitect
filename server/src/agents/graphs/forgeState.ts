import { Annotation } from '@langchain/langgraph';
import type { ContextDepth } from '../../services/archivist.js';
import type { AutonomyMode, CommitPolicy, MasContract, MasIntent, MasLocation, ReviewPolicy } from './masContract.js';

const replace = <T>(_a: T, b: T): T => b;

/** One queue entry — mirrors client/src/stores/forgeSlice.ts's ForgeItem exactly. */
export interface ForgeQueueItem {
  articleId: string;
  title: string;
  depth: number;
  /** Which step to start from for this article. Children always get 'inception'. */
  startStep: 'inception' | 'expansion' | 'branching';
}

export interface ForgeStepError {
  step: string;
  message: string;
  fatal: boolean;
}

export type ForgeContinuationMode = 'one_step' | 'finish_document' | 'recursive';
export type ForgeExistingContentMode = 'create' | 'improve' | 'replace' | 'skip_existing';
export type ForgeBranchingExistingMode = 'append_deduped' | 'skip_if_children';

/**
 * State for the single recursive Forge graph (graphs/forgeGraph.ts) — the
 * server-side replacement for forgeSlice.ts's client-side while(true) loop.
 * Persisted via the checkpointer (agents/checkpointer.ts) keyed on runId as
 * thread_id, so the full queue/config/progress survives a pause or a server
 * restart: resumeForgeRun reads it back via graph.getState() rather than
 * requiring a second, redundant place to store the same data.
 */
export const ForgeAnnotation = Annotation.Root({
  worldId: Annotation<string>(),
  runId: Annotation<string>(),
  ownerId: Annotation<string>(),

  // --- config, set once at start, unchanged for the life of the run ---
  contextDepth: Annotation<ContextDepth>({ reducer: replace, default: () => 'mid' }),
  branchingMode: Annotation<'specific' | 'conceptual'>({ reducer: replace, default: () => 'conceptual' }),
  forgeMode: Annotation<'breadth' | 'depth'>({ reducer: replace, default: () => 'breadth' }),
  forgeMaxDepth: Annotation<number>({ reducer: replace, default: () => 2 }),
  forgeMaxChildren: Annotation<number>({ reducer: replace, default: () => 0 }),
  forgeUseOracle: Annotation<boolean>({ reducer: replace, default: () => false }),
  forgeUseContinuityEditor: Annotation<boolean>({ reducer: replace, default: () => false }),
  forgeUseGroundingCheck: Annotation<boolean>({ reducer: replace, default: () => false }),
  forgeUseDedupCheck: Annotation<boolean>({ reducer: replace, default: () => false }),
  forgeContinuationMode: Annotation<ForgeContinuationMode>({ reducer: replace, default: () => 'recursive' }),
  forgeInceptionExistingMode: Annotation<ForgeExistingContentMode>({ reducer: replace, default: () => 'improve' }),
  forgeExpansionExistingMode: Annotation<ForgeExistingContentMode>({ reducer: replace, default: () => 'improve' }),
  forgeBranchingExistingMode: Annotation<ForgeBranchingExistingMode>({ reducer: replace, default: () => 'append_deduped' }),
  masContract: Annotation<MasContract | undefined>({ reducer: replace, default: () => undefined }),
  masLocation: Annotation<MasLocation | undefined>({ reducer: replace, default: () => undefined }),
  masIntent: Annotation<MasIntent | undefined>({ reducer: replace, default: () => undefined }),
  autonomyMode: Annotation<AutonomyMode>({ reducer: replace, default: () => 'auto_with_post_review' }),
  reviewPolicy: Annotation<ReviewPolicy>({ reducer: replace, default: () => 'auto' }),
  commitPolicy: Annotation<CommitPolicy>({ reducer: replace, default: () => 'auto_commit' }),

  // --- queue + per-item working state ---
  queue: Annotation<ForgeQueueItem[]>({ reducer: replace, default: () => [] }),
  currentItem: Annotation<ForgeQueueItem | undefined>({ reducer: replace, default: () => undefined }),
  inceptionIntro: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  /**
   * Steps already completed for currentItem — lets a resume after a crash
   * mid-cascade (server killed between, say, Inception and Expansion) skip
   * the step(s) that already succeeded instead of either re-running the
   * whole item from scratch or — the bug this fixed — dequeueNode silently
   * discarding the in-flight item and popping the next one instead.
   */
  currentItemStepsDone: Annotation<Array<'inception' | 'expansion' | 'branching'>>({
    reducer: replace,
    default: () => [],
  }),

  // --- progress ---
  completed: Annotation<number>({ reducer: replace, default: () => 0 }),
  total: Annotation<number>({ reducer: replace, default: () => 0 }),

  // --- control flow ---
  signal: Annotation<'continue' | 'paused' | 'stopped' | 'completed' | 'error' | undefined>({
    reducer: replace,
    default: () => undefined,
  }),
  lastStepError: Annotation<ForgeStepError | undefined>({ reducer: replace, default: () => undefined }),
});

export type ForgeState = typeof ForgeAnnotation.State;
