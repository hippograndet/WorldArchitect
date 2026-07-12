import { ArchitectAgent } from '../../architect.js';
import { callCtx } from './shared.js';
import type { OrchestrationState } from '../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// createWorld — Architect
// ---------------------------------------------------------------------------

export async function architectNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new ArchitectAgent();
  const result = await agent.run(state.worldId, {
    seedText: state.seedText!,
    categories: state.categories,
    worldContext: state.worldContext,
  }, callCtx(state));
  return { stubs: result.output.stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
