import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';
import { upsertEntry } from '../services/worldBible.js';
import { type ContextDepth } from '../services/archivist.js';
import { writeArticleVersion } from '../services/articleVersions.js';
import type { Stub } from './architect.js';
import type { ProposalItem } from './muse.js';
import type { MentionItem } from './scribe.js';
import type { ChildProposalItem } from './cartographer.js';
import type { CoherenceWarning, SuggestedLink, WardenOutput } from './warden.js';
import type { RetentionIssue, SentinelOutput } from './sentinel.js';
import type { AgentSideChannel } from './base.js';
import type { CompressionEntry } from './condenser.js';
import type { IdeaItem } from './oracle.js';
import type { StyleWardenOutput } from './styleWarden.js';
import type { ContinuityEditorOutput } from './continuityEditor.js';
import type { EdgeProposal, GlobalWarning } from './auditor.js';
import type { ProposalMode } from '../prompts/proposal.js';
import type { ExpanderMode } from '../prompts/expander.js';
import type { WorldStyleConfig } from '../services/worldStylePresets.js';
import { runCreateWorldGraph } from './graphs/pipelines/createWorld.js';
import { runProposeGraph } from './graphs/pipelines/propose.js';
import { runProposeIdeasGraph } from './graphs/pipelines/proposeIdeas.js';
import { runExpandGraph } from './graphs/pipelines/expand.js';
import { runSummarizeGraph } from './graphs/pipelines/summarize.js';
import { runProposeChildrenGraph } from './graphs/pipelines/proposeChildren.js';
import { runReorganizeGraph } from './graphs/pipelines/reorganize.js';
import { runCohereGraph } from './graphs/pipelines/cohere.js';
import { runChronologyGraph } from './graphs/pipelines/chronology.js';
import { runCompressGraph } from './graphs/pipelines/compress.js';
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
  proposals: ProposalItem[];
  autoSelectedIndex?: number;
  autoSelectRationale?: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProposeIdeasOutput {
  ideas: IdeaItem[];
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
  tokensIn: number;
  tokensOut: number;
}

export interface ChronologyOutput {
  chronologySection: string;
  coherenceWarnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
  styleCheck?: StyleWardenOutput;
  tokensIn: number;
  tokensOut: number;
}

export interface CompressOutput {
  entries: CompressionEntry[];
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
  // create_world pipeline — Architect
  // ---------------------------------------------------------------------------

  async createWorld(
    worldId: string,
    seedText: string,
  ): Promise<{ stubs: Stub[]; tokensIn: number; tokensOut: number }> {
    const exec = getDbClient();

    const categories = await exec.all<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE world_id = ? ORDER BY sort_order',
      [worldId],
    );

    if (categories.length === 0) throw new Error('World has no categories');

    const result = await runCreateWorldGraph({ worldId, seedText, categories });
    const { stubs } = result;

    const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const now = Date.now();
    const ownerId = await ownerIdForWorld(exec, worldId);

    await exec.transaction(async (tx) => {
      for (const stub of stubs) {
        const categoryId = categoryMap.get(stub.categoryName.toLowerCase());
        if (!categoryId) continue;

        const articleId = nanoid();
        const versionId = nanoid();

        await tx.run(
          `INSERT INTO articles
             (id, world_id, owner_id, category_id, title, status, template_type,
              depth, current_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'stub', ?, 2, ?, ?, ?)`,
          [articleId, worldId, ownerId, categoryId, stub.title, stub.templateType, versionId, now, now],
        );

        await writeArticleVersion(tx, {
          articleId,
          ownerId,
          versionId,
          versionNumber: 1,
          introduction: stub.summary,
          description: '',
          chronology: '',
          wordCount: 0,
          now,
        });

        await upsertEntry(tx, worldId, articleId, stub.summary);
      }
    });

    return { stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  }

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
  ): Promise<ProposeOutput> {
    return runProposeGraph({ worldId, articleId, pipelineType, userSpec, autoSelect, contextDepth });
  }

  // ---------------------------------------------------------------------------
  // Step B: proposeIdeas — Oracle
  // ---------------------------------------------------------------------------

  async proposeIdeas(
    worldId: string,
    articleId: string,
    introduction: string,
    selectedProposal: ProposalItem,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ProposeIdeasOutput> {
    return runProposeIdeasGraph({ worldId, articleId, introduction, selectedProposal, userSpec, contextDepth });
  }

  // ---------------------------------------------------------------------------
  // Phase 2: expand — Scribe → Lorekeeper → (optional StyleWarden)
  // ---------------------------------------------------------------------------

  async expand(
    worldId: string,
    articleId: string,
    pipelineType: ExpanderMode,
    selectedProposal: ProposalItem,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    selectedIdeas?: IdeaItem[],
    runStyleWarden = false,
    runContinuityEditor = false,
    wordCountPreset: 'short' | 'medium' | 'long' = 'medium',
  ): Promise<ExpandOutput> {
    return runExpandGraph({
      worldId, articleId, pipelineType, selectedProposal, userSpec, contextDepth,
      selectedIdeas, runStyleWarden, runContinuityEditor, wordCountPreset,
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
    return runSummarizeGraph({ worldId, articleId, mode });
  }

  // ---------------------------------------------------------------------------
  // propose_children — Cartographer
  // ---------------------------------------------------------------------------

  async proposeChildren(
    worldId: string,
    articleId: string,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ProposeChildrenOutput> {
    return runProposeChildrenGraph({ worldId, articleId, userSpec, contextDepth });
  }

  // ---------------------------------------------------------------------------
  // reorganize — Scribe [reorganize] → Sentinel → Lorekeeper
  // ---------------------------------------------------------------------------

  async reorganize(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ReorganizeOutput> {
    return runReorganizeGraph({ worldId, articleId, contextDepth });
  }

  // ---------------------------------------------------------------------------
  // cohere (standalone) — Warden
  // ---------------------------------------------------------------------------

  async cohere(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<{ warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[]; tokensIn: number; tokensOut: number }> {
    return runCohereGraph({ worldId, articleId, contextDepth });
  }

  // ---------------------------------------------------------------------------
  // expand_chronology — Chronicler → Warden → (optional StyleWarden)
  // ---------------------------------------------------------------------------

  async expandChronology(
    worldId: string,
    articleId: string,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    runStyleWarden = false,
  ): Promise<ChronologyOutput> {
    return runChronologyGraph({ worldId, articleId, userSpec, contextDepth, runStyleWarden });
  }

  // ---------------------------------------------------------------------------
  // compress — Condenser (preview only)
  // ---------------------------------------------------------------------------

  async compress(worldId: string): Promise<CompressOutput> {
    return runCompressGraph({ worldId });
  }

  // ---------------------------------------------------------------------------
  // audit — Auditor (world-wide coherence scan)
  // ---------------------------------------------------------------------------

  async audit(worldId: string, sampleSize?: number, focus: 'all' | 'recent' = 'all'): Promise<AuditOutput> {
    return runAuditGraph({ worldId, sampleSize, focus });
  }
}
