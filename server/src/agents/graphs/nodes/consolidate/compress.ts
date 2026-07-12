import { getEntries } from '../../../../services/worldBible.js';
import { CondenserAgent } from '../../../condenser.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// compress — Condenser (preview only, no DB writes)
// ---------------------------------------------------------------------------

export async function loadBibleEntriesNode(state: OrchestrationState): Promise<Partial_> {
  const bibleEntries = await getEntries(state.worldId, state.ownerId);
  return {
    bibleEntries: bibleEntries.map((e) => ({ articleId: e.articleId, title: e.articleTitle, summary: e.summary })),
  };
}

export async function condenserNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new CondenserAgent();
  const result = await agent.run(state.worldId, { worldContext: state.worldContext!, entries: state.bibleEntries }, callCtx(state));
  return { compressedEntries: result.output.entries, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
