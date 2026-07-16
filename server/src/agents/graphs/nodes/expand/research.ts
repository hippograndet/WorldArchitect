import { ResearcherAgent } from '../../../researcher.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// expand — Researcher (also reused as the standalone Research step)
// ---------------------------------------------------------------------------

/** No-op when researchBrief was already supplied externally (e.g. by researchNode running ahead of this pipeline in forgeGraph.ts) — mirrors fetchWorldContextNode/buildContextPackageNode's caching guards. */
export async function researcherNode(state: OrchestrationState): Promise<Partial_> {
  if (state.researchBrief) return {};
  const agent = new ResearcherAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldInfoContext: state.worldInfoContext!,
    userSpec: state.userSpec,
  }, callCtx(state));
  return { researchBrief: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
