import { SentinelAgent } from '../../../sentinel.js';
import { HeraldAgent } from '../../../herald.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// reorganize — Sentinel + Herald (pipelines/reorganize.ts also reuses
// nodes/forge/draft.ts's scribeNode for the reorganize-mode draft itself)
// ---------------------------------------------------------------------------

export async function sentinelNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new SentinelAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    originalBody: state.contextPackage!.targetDescription,
    reorganizedDescription: state.description!,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { retentionIssues: result.output.issues, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/**
 * Always runs, no mode gate — used by reorganize(), which refreshes the
 * introduction on every call from researchBrief/worldContext, not from the
 * reorganized Description (outside Herald's scope).
 *
 * Name kept as lorekeeperSummarizeUnconditionalNode (not renamed to Herald)
 * — Consolidate pipeline, out of scope for the Herald rename; noted here for
 * a future pass. Still uses HeraldAgent internally since LorekeepAgent no
 * longer exists.
 */
export async function lorekeeperSummarizeUnconditionalNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new HeraldAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { introduction: result.output.introduction, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
