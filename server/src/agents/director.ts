import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';
import { type ContextDepth } from '../services/archivist.js';
import type { DraftContextBasis } from '../services/draftsService.js';
import type { MentionItem } from './scribe.js';
import type { ChildProposalItem } from './cartographer.js';
import type { CoherenceWarning, SuggestedLink, WardenOutput } from './warden.js';
import type { RetentionIssue, SentinelOutput } from './sentinel.js';
import type { AgentSideChannel } from './base.js';
import type { IdeaItem } from './muse.js';
import type { StyleWardenOutput } from './styleWarden.js';
import type { ContinuityEditorOutput } from './continuityEditor.js';
import type { EdgeProposal, GlobalWarning } from './auditor.js';
import type { ProposalMode } from '../prompts/proposal.js';
import type { ExpanderMode } from '../prompts/expander.js';
import type { WorldStyleConfig } from '../services/worldStylePresets.js';
import { runProposeGraph } from './graphs/pipelines/propose.js';
import { runExpandGraph } from './graphs/pipelines/expand.js';
import { runSummarizeGraph } from './graphs/pipelines/summarize.js';
import { runProposeChildrenGraph } from './graphs/pipelines/proposeChildren.js';
import { runReorganizeGraph } from './graphs/pipelines/reorganize.js';
import { runCohereGraph } from './graphs/pipelines/cohere.js';
import { runAuditGraph } from './graphs/pipelines/audit.js';

// ---------------------------------------------------------------------------
// WorldContext — shared agent architecture
// ---------------------------------------------------------------------------

export interface WorldContext {
  worldId: string;
  name: string;
  tone: string;
  originPoint: string | null;
  styleConfig: WorldStyleConfig | null;
}

export async function fetchWorldContext(worldId: string): Promise<WorldContext> {
  const row = await getDbClient().get<Record<string, unknown>>(
    'SELECT id, name, tone, origin_point, style_config FROM worlds WHERE id = ?',
    [worldId],
  );

  if (!row) throw new Error(`World ${worldId} not found`);

  let styleConfig: WorldStyleConfig | null = null;
  try {
    const raw = JSON.parse((row.style_config as string) || '{}');
    if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      styleConfig = raw as WorldStyleConfig;
    }
  } catch { /* ignore malformed JSON */ }

  return {
    worldId,
    name: row.name as string,
    tone: row.tone as string,
    originPoint: (row.origin_point as string | null) ?? null,
    styleConfig,
  };
}

// ---------------------------------------------------------------------------
// Side-channel adapters — check-mode agents' existing bespoke outputs, reshaped
// onto the common AgentSideChannel (base.ts) so future orchestration/persistence
// can consume one shape regardless of which agent produced it. Standalone
// functions, not PipelineCoordinator methods: no public method's parameters or
// return type changes because of these — cohere()/audit()/reorganize() below
// keep returning exactly WardenOutput-shaped/AuditOutput/ReorganizeOutput data.
// ---------------------------------------------------------------------------

export function sideChannelFromWarden(articleId: string, output: WardenOutput): AgentSideChannel {
  return {
    coherenceWarnings: output.warnings.map((w) => ({
      severity: w.severity,
      description: w.description,
      ...(w.sourceArticleId ? { involvedArticleIds: [w.sourceArticleId] } : {}),
    })),
    proposedDependencies: output.suggestedLinks
      .filter((l) => l.targetArticleId)
      .map((l) => ({
        sourceArticleId: articleId,
        targetArticleId: l.targetArticleId!,
        dependencyType: 'reference',
      })),
  };
}

export function sideChannelFromAuditor(output: AuditOutput): AgentSideChannel {
  return {
    proposedDependencies: output.edgeProposals.map((ep) => ({
      sourceArticleId: ep.sourceArticleId,
      targetArticleId: ep.targetArticleId,
      dependencyType: ep.linkType === 'hierarchical' ? 'hierarchy' : 'reference',
      reason: ep.rationale,
    })),
    coherenceWarnings: output.globalWarnings.map((gw) => ({
      severity: gw.severity,
      description: gw.description,
      involvedArticleIds: gw.involvedArticleIds,
    })),
  };
}

export function sideChannelFromSentinel(output: SentinelOutput): AgentSideChannel {
  return {
    issues: output.issues.map((i) => ({
      severity: i.severity === 'critical' ? 'blocking' : 'warning',
      explanation: i.description,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pipeline output types
// ---------------------------------------------------------------------------

export interface ProposeOutput {
  ideas: IdeaItem[];
  autoSelectedIndices?: number[];
  autoSelectRationale?: string;
  contextDraftIds?: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface ExpandOutput {
  description: string;
  introduction?: string;
  parentUpdate?: { appendText: string };
  styleCheck?: StyleWardenOutput;
  continuityCheck?: ContinuityEditorOutput;
  mentions?: MentionItem[];
  contextDraftIds?: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface SummarizeOutput {
  introduction: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProposeChildrenOutput {
  proposals: ChildProposalItem[];
  tokensIn: number;
  tokensOut: number;
}

export interface ReorganizeOutput {
  description: string;
  introduction: string;
  retentionIssues: RetentionIssue[];
  contextDraftIds?: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface AuditOutput {
  edgeProposals: EdgeProposal[];
  globalWarnings: GlobalWarning[];
  tokensIn: number;
  tokensOut: number;
}

// ---------------------------------------------------------------------------
// PipelineCoordinator
//
// Each method assembles its inputs and delegates to the matching LangGraph
// pipeline in agents/graphs/pipelines/*.ts (composed from the shared node
// library in agents/graphs/nodes.ts) — same agents, same steps, same
// persistence, just orchestrated via LangGraph instead of hand-rolled
// sequential await calls. Kept as a class (not replaced with standalone
// functions) because WorldContext/fetchWorldContext/the side-channel
// adapters/every *Output type above are imported from this file across ~40
// other files — routes/agents.ts and routes/worlds.ts need zero changes.
// ---------------------------------------------------------------------------

export class PipelineCoordinator {
  // ---------------------------------------------------------------------------
  // Phase 1: propose — Muse (+ optional Curator auto-select)
  // ---------------------------------------------------------------------------

  async propose(
    worldId: string,
    articleId: string,
    pipelineType: ProposalMode,
    userSpec?: string,
    autoSelect = false,
    contextDepth: ContextDepth = 'mid',
    contextBasis: DraftContextBasis = 'current',
  ): Promise<ProposeOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runProposeGraph({ worldId, ownerId, articleId, pipelineType, userSpec, autoSelect, contextDepth, contextBasis });
  }

  // ---------------------------------------------------------------------------
  // Phase 2: expand — Scribe → Lorekeeper → (optional StyleWarden)
  // ---------------------------------------------------------------------------

  async expand(
    worldId: string,
    articleId: string,
    pipelineType: ExpanderMode,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    selectedIdeas?: IdeaItem[],
    runStyleWarden = false,
    coherenceCheckLevel = 0,
    safetyNet = false,
    wordCountPreset: 'short' | 'medium' | 'long' = 'medium',
    contextBasis: DraftContextBasis = 'current',
  ): Promise<ExpandOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runExpandGraph({
      worldId, ownerId, articleId, pipelineType, userSpec, contextDepth, contextBasis,
      selectedIdeas, runStyleWarden, coherenceCheckLevel, safetyNet, wordCountPreset,
    });
  }

  // ---------------------------------------------------------------------------
  // summarize (standalone) — Lorekeeper only
  // ---------------------------------------------------------------------------

  async summarize(
    worldId: string,
    articleId: string,
    mode: 'full' | 'improve' = 'full',
  ): Promise<SummarizeOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runSummarizeGraph({ worldId, ownerId, articleId, mode });
  }

  // ---------------------------------------------------------------------------
  // propose_children — Cartographer
  // ---------------------------------------------------------------------------

  async proposeChildren(
    worldId: string,
    articleId: string,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    contextBasis: DraftContextBasis = 'current',
    coherenceCheckLevel = 0,
    safetyNet = false,
  ): Promise<ProposeChildrenOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runProposeChildrenGraph({ worldId, ownerId, articleId, userSpec, contextDepth, contextBasis, coherenceCheckLevel, safetyNet });
  }

  // ---------------------------------------------------------------------------
  // reorganize — Scribe [reorganize] → Sentinel → Lorekeeper
  // ---------------------------------------------------------------------------

  async reorganize(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
    contextBasis: DraftContextBasis = 'current',
  ): Promise<ReorganizeOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runReorganizeGraph({ worldId, ownerId, articleId, contextDepth, contextBasis });
  }

  // ---------------------------------------------------------------------------
  // cohere (standalone) — Warden
  // ---------------------------------------------------------------------------

  async cohere(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
    contextBasis: DraftContextBasis = 'current',
  ): Promise<{ warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[]; tokensIn: number; tokensOut: number }> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runCohereGraph({ worldId, ownerId, articleId, contextDepth, contextBasis });
  }

  // ---------------------------------------------------------------------------
  // audit — Auditor (world-wide coherence scan)
  // ---------------------------------------------------------------------------

  async audit(worldId: string, sampleSize?: number, focus: 'all' | 'recent' = 'all'): Promise<AuditOutput> {
    const ownerId = await ownerIdForWorld(getDbClient(), worldId);
    return runAuditGraph({ worldId, ownerId, sampleSize, focus });
  }
}
