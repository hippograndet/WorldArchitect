import { Annotation } from '@langchain/langgraph';
import type { ContextPackage, ArchivistMode, ContextDepth } from '../../services/archivist.js';
import type { WorldContext } from '../director.js';
import type { ProposalMode } from '../../prompts/proposal.js';
import type { ExpanderMode } from '../../prompts/expander.js';
import type { AuditorArticleSummary } from '../../prompts/auditor.js';
import type { Stub } from '../architect.js';
import type { ProposalItem } from '../muse.js';
import type { IdeaItem } from '../oracle.js';
import type { ChildProposalItem } from '../cartographer.js';
import type { CoherenceWarning, SuggestedLink } from '../warden.js';
import type { RetentionIssue } from '../sentinel.js';
import type { ContinuityEditorOutput } from '../continuityEditor.js';
import type { StyleWardenOutput } from '../styleWarden.js';
import type { MentionItem, ScribeOutput, ResearchBrief } from '../scribe.js';
import type { LorekeepMode } from '../lorekeeper.js';
import type { EdgeProposal, GlobalWarning } from '../auditor.js';
import type { CompressionEntry } from '../condenser.js';
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
  articleId: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  worldContext: Annotation<WorldContext | undefined>({ reducer: replace, default: () => undefined }),
  contextPackage: Annotation<ContextPackage | undefined>({ reducer: replace, default: () => undefined }),
  contextDepth: Annotation<ContextDepth>({ reducer: replace, default: () => 'mid' }),
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

  // --- createWorld (Architect) ---
  seedText: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  categories: Annotation<Array<{ id: string; name: string }>>({ reducer: replace, default: () => [] }),
  stubs: Annotation<Stub[]>({ reducer: replace, default: () => [] }),

  // --- propose (Muse + optional Curator auto-select) ---
  proposalMode: Annotation<ProposalMode | undefined>({ reducer: replace, default: () => undefined }),
  autoSelect: Annotation<boolean>({ reducer: replace, default: () => false }),
  proposals: Annotation<ProposalItem[]>({ reducer: replace, default: () => [] }),
  autoSelectedIndex: Annotation<number | undefined>({ reducer: replace, default: () => undefined }),
  autoSelectRationale: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // --- proposeIdeas (Oracle) — introduction here is an *input*
  // (the article's current/produced intro); expand/summarize write the
  // same field as *output* below — same meaning either way (the
  // article's introduction text), just produced by different pipelines. ---
  introduction: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  selectedProposal: Annotation<ProposalItem | undefined>({ reducer: replace, default: () => undefined }),
  ideas: Annotation<IdeaItem[]>({ reducer: replace, default: () => [] }),

  // --- expand (Researcher -> Scribe [-> ContinuityEditor loop] [-> Lorekeeper] [-> StyleWarden]) ---
  expanderMode: Annotation<ExpanderMode | undefined>({ reducer: replace, default: () => undefined }),
  selectedIdeas: Annotation<IdeaItem[] | undefined>({ reducer: replace, default: () => undefined }),
  runStyleWarden: Annotation<boolean>({ reducer: replace, default: () => false }),
  runContinuityEditor: Annotation<boolean>({ reducer: replace, default: () => false }),
  wordCountPreset: Annotation<'short' | 'medium' | 'long'>({ reducer: replace, default: () => 'medium' }),
  researchBrief: Annotation<ResearchBrief | undefined>({ reducer: replace, default: () => undefined }),
  scribeOutput: Annotation<ScribeOutput | undefined>({ reducer: replace, default: () => undefined }),
  continuityCheck: Annotation<ContinuityEditorOutput | undefined>({ reducer: replace, default: () => undefined }),
  description: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  parentUpdate: Annotation<{ appendText: string } | undefined>({ reducer: replace, default: () => undefined }),
  styleCheck: Annotation<StyleWardenOutput | undefined>({ reducer: replace, default: () => undefined }),
  mentions: Annotation<MentionItem[] | undefined>({ reducer: replace, default: () => undefined }),

  // --- summarize (Lorekeeper) ---
  lorekeeperMode: Annotation<LorekeepMode>({ reducer: replace, default: () => 'full' }),
  existingIntro: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // --- proposeChildren (Cartographer) ---
  childProposals: Annotation<ChildProposalItem[]>({ reducer: replace, default: () => [] }),

  // --- reorganize (Scribe[reorganize] -> Sentinel -> Lorekeeper) ---
  retentionIssues: Annotation<RetentionIssue[]>({ reducer: replace, default: () => [] }),

  // --- cohere / expandChronology (Warden [+ Chronicler]) ---
  warnings: Annotation<CoherenceWarning[]>({ reducer: replace, default: () => [] }),
  suggestedLinks: Annotation<SuggestedLink[]>({ reducer: replace, default: () => [] }),
  chronologySection: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // --- compress (Condenser) ---
  bibleEntries: Annotation<Array<{ articleId: string; title: string; summary: string }>>({ reducer: replace, default: () => [] }),
  compressedEntries: Annotation<CompressionEntry[]>({ reducer: replace, default: () => [] }),

  // --- audit (Auditor) ---
  sampleSize: Annotation<number | undefined>({ reducer: replace, default: () => undefined }),
  focus: Annotation<'all' | 'recent'>({ reducer: replace, default: () => 'all' }),
  articleSummaries: Annotation<AuditorArticleSummary[]>({ reducer: replace, default: () => [] }),
  edgeProposals: Annotation<EdgeProposal[]>({ reducer: replace, default: () => [] }),
  globalWarnings: Annotation<GlobalWarning[]>({ reducer: replace, default: () => [] }),
});

export type OrchestrationState = typeof OrchestrationAnnotation.State;

/** Passed once at archivistMode call sites — 'default'/'reorganize'/'propose_children'/'expand_chronology'. */
export type { ArchivistMode };
