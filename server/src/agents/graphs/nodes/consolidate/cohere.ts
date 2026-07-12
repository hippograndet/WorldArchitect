import { WardenAgent } from '../../../warden.js';
import { callCtx, hasSufficientBibleContent } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// cohere — Warden
// ---------------------------------------------------------------------------

/**
 * Skips the LLM call entirely when the world bible is too sparse for a
 * coherence check to mean anything (hasSufficientBibleContent) — the same
 * guard director.ts's cohere() already has.
 */
export async function wardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!(await hasSufficientBibleContent(state.worldId, state.ownerId))) return { warnings: [], suggestedLinks: [] };

  const newContent = state.contextPackage!.targetDescription;
  const contentLabel = 'Article Body';

  const agent = new WardenAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    newContent,
    contentLabel,
  }, callCtx(state));
  return { warnings: result.output.warnings, suggestedLinks: result.output.suggestedLinks, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
