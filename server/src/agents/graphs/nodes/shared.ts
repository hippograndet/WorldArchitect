import { getDbClient } from '../../../db/client.js';
import { buildContextPackage } from '../../../services/archivist.js';
import { fetchWorldContext } from '../../director.js';
import type { OrchestrationState } from '../state.js';

type Partial_ = Partial<OrchestrationState>;

/** Shared call_log correlation context passed as every agent.run()'s third argument below. */
export function callCtx(state: OrchestrationState): { pipelineRunId: string; pipelineType: string; articleId?: string; ownerId?: string } {
  return {
    pipelineRunId: state.pipelineRunId,
    pipelineType: state.pipelineType,
    articleId: state.articleId,
    ownerId: state.ownerId,
  };
}

/** Returns true if the world bible has enough entries for a coherence check to be meaningful. */
export async function hasSufficientBibleContent(worldId: string, ownerId?: string): Promise<boolean> {
  const row = await getDbClient().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM world_bible_entries WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''} AND summary != ''`,
    ownerId ? [worldId, ownerId] : [worldId],
  );
  return row!.n >= 5;
}

// ---------------------------------------------------------------------------
// Common setup nodes — used at the start of nearly every pipeline graph
// ---------------------------------------------------------------------------

/**
 * Skips the fetch when a caller has already seeded worldContext (e.g. a
 * cached run-level value threaded in via graph.invoke()) — this guard is
 * shared by every pipeline graph's identical __start__ edge, so any future
 * caller must seed a real WorldContext for this worldId, never a stand-in.
 */
export async function fetchWorldContextNode(state: OrchestrationState): Promise<Partial_> {
  if (state.worldContext) return {};
  return { worldContext: await fetchWorldContext(state.worldId) };
}

/**
 * Skips the build when a caller has already seeded contextPackage. Shared by
 * every pipeline graph's identical __start__ edge — a seeded package MUST
 * have been built under the same ArchivistMode/contextDepth this call would
 * otherwise use, since ContextPackage carries no record of which mode built
 * it. Today only expansionNode (mode 'default') seeds this; do not thread a
 * cached package into proposeChildren.ts ('propose_children' mode) or a
 * 'reorganize'-mode call without adding a mode check first. Since
 * researchNode (graphs/pipelines/research.ts) now runs before Inception for
 * every Forge queue item, it is the primary producer for the whole
 * Research→Inception→Expansion cascade — expansionNode reuses its cached
 * package (see forgeGraph.ts's resolveItemContextPackage) instead of this
 * node rebuilding it a second time.
 *
 * The full package is still built here (Researcher genuinely needs its
 * neighborhood tiers), but as of v10 it's no longer *passed whole* to any
 * other Expand agent — every other node below extracts only the specific
 * fields (targetTitle, targetIntroduction, etc.) its agent actually needs
 * from `state.contextPackage`, relying on Researcher's brief for grounding
 * instead of re-rendering the raw parents/siblings/fixedPoints tiers.
 */
export async function buildContextPackageNode(state: OrchestrationState): Promise<Partial_> {
  if (state.contextPackage) return {};
  const contextPackage = await buildContextPackage(state.worldId, state.articleId!, {
    mode: state.contextMode,
    contextDepth: state.contextDepth,
    contextBasis: state.contextBasis,
    ownerId: state.ownerId,
  });
  return { contextPackage };
}
