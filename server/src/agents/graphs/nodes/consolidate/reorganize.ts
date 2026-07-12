import { SentinelAgent } from '../../../sentinel.js';
import { LorekeepAgent } from '../../../lorekeeper.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// reorganize — Sentinel + Lorekeeper (pipelines/reorganize.ts also reuses
// nodes/expand/draft.ts's scribeNode for the reorganize-mode draft itself)
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

/** Always runs, no mode gate — used by reorganize(), which refreshes the introduction on every call from researchBrief/worldContext, not from the reorganized Description (outside Lorekeeper's scope). */
export async function lorekeeperSummarizeUnconditionalNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new LorekeepAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    worldContext: state.worldContext!,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { introduction: result.output.introduction, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
