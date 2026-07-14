import { Annotation } from '@langchain/langgraph';
import type { ContextDepth, ContextPackage } from '../../services/archivist.js';
import type { DraftContextBasis } from '../../services/draftsService.js';
import type { AutonomyMode, CommitPolicy, MasContract, MasIntent, MasLocation, ReviewPolicy } from './masContract.js';
import type { WorldContext } from '../director.js';
import type { ResearchBrief } from '../scribe.js';

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
  /** Fetched once in startForgeRun and reused for every article — world-level metadata can't change mid-run. */
  worldContext: Annotation<WorldContext | undefined>({ reducer: replace, default: () => undefined }),
  contextDepth: Annotation<ContextDepth>({ reducer: replace, default: () => 'mid' }),
  contextBasis: Annotation<DraftContextBasis>({ reducer: replace, default: () => 'current' }),
  branchingMode: Annotation<'specific' | 'conceptual'>({ reducer: replace, default: () => 'conceptual' }),
  forgeMode: Annotation<'breadth' | 'depth'>({ reducer: replace, default: () => 'breadth' }),
  forgeMaxDepth: Annotation<number>({ reducer: replace, default: () => 2 }),
  forgeMaxChildren: Annotation<number>({ reducer: replace, default: () => 0 }),
  /** One global dial covering Continuity Editor, Grounding Check, and Dedup Check — see state.ts's coherenceCheckLevel/safetyNet and nodes.ts's runCheckReviseLoop. */
  coherenceCheckLevel: Annotation<number>({ reducer: replace, default: () => 0 }),
  safetyNet: Annotation<boolean>({ reducer: replace, default: () => false }),
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
   * True from the moment Inception accepts a new introduction for
   * currentItem until something durably carries it forward — either
   * Expansion's own commit (which consumes it via acceptDraft's
   * introductionOverride and clears this flag) or, if Expansion never
   * reaches a commit this cycle (one_step runs, a rejected/errored
   * Expansion), finishItemNode committing it alone. Left false when
   * inceptionIntro was only carried for context (e.g. the skip_existing
   * branch), since nothing actually changed there.
   */
  inceptionIntroChanged: Annotation<boolean>({ reducer: replace, default: () => false }),
  /**
   * Context package built while processing currentItem — set by inceptionNode
   * (patched with the freshly-written intro) when Inception runs, reused by
   * expansionNode instead of rebuilding; reset alongside inceptionIntro each
   * time dequeueNode pops a new item, since it's scoped to one article, not
   * the whole run (unlike worldContext above).
   */
  currentItemContextPackage: Annotation<ContextPackage | undefined>({ reducer: replace, default: () => undefined }),
  /**
   * Research brief produced once per queue item by researchNode — the
   * unconditional prefix step that runs before Inception/Expansion/Branching
   * so a shared brief is available even when startStep skips Inception.
   * Reset alongside currentItemContextPackage each time dequeueNode pops a
   * new item.
   */
  currentItemResearchBrief: Annotation<ResearchBrief | undefined>({ reducer: replace, default: () => undefined }),
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
  /**
   * Items that finished with a non-fatal lastStepError (fatal ones end the
   * whole run via signal:'error' and never reach finishItemNode). Lets
   * finalizeRun tell a run that drained its queue but had failed steps apart
   * from one that genuinely succeeded end-to-end — without this, the run
   * status was unconditionally 'completed' even when every item's only step
   * timed out, contradicting the failed-step banner the client renders from
   * run_events.
   */
  failedItemCount: Annotation<number>({ reducer: replace, default: () => 0 }),

  // --- control flow ---
  signal: Annotation<'continue' | 'paused' | 'needs_input' | 'stopped' | 'completed' | 'error' | undefined>({
    reducer: replace,
    default: () => undefined,
  }),
  lastStepError: Annotation<ForgeStepError | undefined>({ reducer: replace, default: () => undefined }),
});

export type ForgeState = typeof ForgeAnnotation.State;
