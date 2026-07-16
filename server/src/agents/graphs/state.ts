import { Annotation } from '@langchain/langgraph';
import type { ContextPackage, ArchivistMode, ContextDepth, WorldInfoContext } from '../../services/archivist.js';
import type { DraftContextBasis } from '../../services/draftsService.js';
import type { WorldContext } from '../director.js';
import type { ProposalMode } from '../../prompts/proposal.js';
import type { ExpanderMode } from '../../prompts/expander.js';
import type { AuditorArticleSummary } from '../../prompts/auditor.js';
import type { IdeaItem } from '../muse.js';
import type { ChildProposalItem } from '../cartographer.js';
import type { CoherenceWarning, SuggestedLink } from '../warden.js';
import type { RetentionIssue } from '../sentinel.js';
import type { ArbiterOutput } from '../arbiter.js';
import type { StylizerOutput } from '../stylizer.js';
import type { MentionItem, ScribeOutput, ResearchBrief } from '../scribe.js';
import type { HeraldMode } from '../herald.js';
import type { EdgeProposal, GlobalWarning } from '../auditor.js';
import type { GatekeeperOutput } from '../gatekeeper.js';
import type { AutonomyMode, CommitPolicy, MasContract, MasIntent, MasLocation, ReviewPolicy } from './masContract.js';

const replace = <T>(_a: T, b: T): T => b;
const sum = (a: number, b: number): number => a + b;

/**
 * One shared state schema for every graph in graphs/pipelines/*.ts and
 * graphs/forgeGraph.ts — mirrors how buildContextPackage() already unifies
 * many context-assembly modes behind one function rather than one per mode.
 * Fields are grouped by which PipelineCoordinator method(s) use them; a
 * given graph only touches the slice relevant to it, the rest stay at their
 * default. Carries the *whole* ContextPackage (not a narrowed subset) so a
 * future metadata/RAG tier riding on its already-optional fields doesn't
 * require touching this state shape — see ContextPackage in
 * services/archivist.ts and dev-docs/future/design_rag.md.
 */
export const OrchestrationAnnotation = Annotation.Root({
  // --- Core, used by nearly every pipeline ---
  worldId: Annotation<string>(),
  ownerId: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  articleId: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  worldContext: Annotation<WorldContext | undefined>({ reducer: replace, default: () => undefined }),
  worldInfoContext: Annotation<WorldInfoContext | undefined>({ reducer: replace, default: () => undefined }),
  contextPackage: Annotation<ContextPackage | undefined>({ reducer: replace, default: () => undefined }),
  contextDepth: Annotation<ContextDepth>({ reducer: replace, default: () => 'mid' }),
  contextBasis: Annotation<DraftContextBasis>({ reducer: replace, default: () => 'current' }),
  contextMode: Annotation<ArchivistMode>({ reducer: replace, default: () => 'default' }),
  userSpec: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  tokensIn: Annotation<number>({ reducer: sum, default: () => 0 }),
  tokensOut: Annotation<number>({ reducer: sum, default: () => 0 }),
  masContract: Annotation<MasContract | undefined>({ reducer: replace, default: () => undefined }),
  masLocation: Annotation<MasLocation | undefined>({ reducer: replace, default: () => undefined }),
  masIntent: Annotation<MasIntent | undefined>({ reducer: replace, default: () => undefined }),
  autonomyMode: Annotation<AutonomyMode>({ reducer: replace, default: () => 'manual' }),
  reviewPolicy: Annotation<ReviewPolicy>({ reducer: replace, default: () => 'user_must_accept' }),
  commitPolicy: Annotation<CommitPolicy>({ reducer: replace, default: () => 'no_commit' }),
  /** Correlates every agent call within this pipeline invocation in call_log — see routes/callLog.ts's /runs grouping. */
  pipelineRunId: Annotation<string>({ reducer: replace, default: () => '' }),
  pipelineType: Annotation<string>({ reducer: replace, default: () => '' }),

  // --- Coherence checking — one global dial shared by Arbiter and
  // Gatekeeper (Herald has no dedicated checker — removed, not merged).
  // 0 = no checkers at all. N = up to N check-revise cycles, stopping early
  // on approval. safetyNet adds one final check-only pass after the N
  // cycles; a failure there is flagged (recordArticleIssues) but never
  // blocks. See nodes.ts's runCheckReviseLoop.
  coherenceCheckLevel: Annotation<number>({ reducer: replace, default: () => 0 }),
  safetyNet: Annotation<boolean>({ reducer: replace, default: () => false }),

  // --- propose (Muse + optional Curator auto-select) — Muse produces the
  // idea list directly (no separate macro-direction stage); Curator is the
  // one place userSpec enters, selecting a subset when autoSelect is on. ---
  proposalMode: Annotation<ProposalMode | undefined>({ reducer: replace, default: () => undefined }),
  autoSelect: Annotation<boolean>({ reducer: replace, default: () => false }),
  ideas: Annotation<IdeaItem[]>({ reducer: replace, default: () => [] }),
  autoSelectedIndices: Annotation<number[] | undefined>({ reducer: replace, default: () => undefined }),
  autoSelectRationale: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // introduction here is an *input* to reorganize/summarize flows (the
  // article's current/produced intro); expand/summarize write the same
  // field as *output* below — same meaning either way, just produced by
  // different pipelines.
  introduction: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // --- expand (Researcher -> Scribe [-> Arbiter loop] [-> Herald] [-> Stylizer]) ---
  expanderMode: Annotation<ExpanderMode | undefined>({ reducer: replace, default: () => undefined }),
  /**
   * Mirrors heraldMode below: a clean structural signal derived from
   * forgeExpansionExistingMode (see forgeGraph/nodes.ts's expansionNode),
   * consumed by Scribe (ScribeInput.scribeMode) to decide whether to ignore
   * any existing description ('full') or treat it as a seed/constraint
   * ('improve') — only meaningful for expanderMode 'expand_description'.
   */
  scribeMode: Annotation<'full' | 'improve'>({ reducer: replace, default: () => 'full' }),
  selectedIdeas: Annotation<IdeaItem[] | undefined>({ reducer: replace, default: () => undefined }),
  runStylizer: Annotation<boolean>({ reducer: replace, default: () => false }),
  wordCountPreset: Annotation<'short' | 'medium' | 'long'>({ reducer: replace, default: () => 'medium' }),
  researchBrief: Annotation<ResearchBrief | undefined>({ reducer: replace, default: () => undefined }),
  scribeOutput: Annotation<ScribeOutput | undefined>({ reducer: replace, default: () => undefined }),
  arbiterCheck: Annotation<ArbiterOutput | undefined>({ reducer: replace, default: () => undefined }),
  description: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  parentUpdate: Annotation<{ appendText: string } | undefined>({ reducer: replace, default: () => undefined }),
  styleCheck: Annotation<StylizerOutput | undefined>({ reducer: replace, default: () => undefined }),
  mentions: Annotation<MentionItem[] | undefined>({ reducer: replace, default: () => undefined }),

  // --- summarize (Herald) ---
  heraldMode: Annotation<HeraldMode>({ reducer: replace, default: () => 'full' }),
  existingIntro: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // --- proposeChildren (Cartographer [+ optional Gatekeeper]) ---
  childProposals: Annotation<ChildProposalItem[]>({ reducer: replace, default: () => [] }),
  gatekeeperCheck: Annotation<GatekeeperOutput | undefined>({ reducer: replace, default: () => undefined }),

  // --- reorganize (Scribe[reorganize] -> Sentinel -> Herald) ---
  retentionIssues: Annotation<RetentionIssue[]>({ reducer: replace, default: () => [] }),

  // --- cohere (Warden) ---
  warnings: Annotation<CoherenceWarning[]>({ reducer: replace, default: () => [] }),
  suggestedLinks: Annotation<SuggestedLink[]>({ reducer: replace, default: () => [] }),

  // --- audit (Auditor) ---
  sampleSize: Annotation<number | undefined>({ reducer: replace, default: () => undefined }),
  focus: Annotation<'all' | 'recent'>({ reducer: replace, default: () => 'all' }),
  articleSummaries: Annotation<AuditorArticleSummary[]>({ reducer: replace, default: () => [] }),
  edgeProposals: Annotation<EdgeProposal[]>({ reducer: replace, default: () => [] }),
  globalWarnings: Annotation<GlobalWarning[]>({ reducer: replace, default: () => [] }),
});

export type OrchestrationState = typeof OrchestrationAnnotation.State;

/** Passed once at archivistMode call sites — 'default'/'reorganize'/'propose_children'. */
export type { ArchivistMode };
