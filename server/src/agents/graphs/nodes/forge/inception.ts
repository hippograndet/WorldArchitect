import { getDbClient } from '../../../../db/client.js';
import { ownerParams, ownerPredicate, worldOwnerParams, worldOwnerPredicate } from '../../../../db/tenantScope.js';
import { HeraldAgent } from '../../../herald.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// summarize (standalone) / Inception — Herald writes the World Bible
// introduction
// ---------------------------------------------------------------------------

/**
 * Herald's introduction — a single write call, no dedicated fact-checker.
 * Its output is short (~80 words) and constrained by the research brief,
 * making unchecked deviation inherently low; deeper checking of the
 * committed introduction happens in Consolidate (Linter, Warden), not by
 * refusing to commit at all.
 */
export async function heraldWriteIntroNode(state: OrchestrationState): Promise<Partial_> {
  const article = await getDbClient().get<{ title: string; introduction: string }>(
    `SELECT a.title, av.introduction
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', state.ownerId)}
     WHERE a.id = ? AND ${worldOwnerPredicate('a', state.ownerId)}`,
    [...ownerParams(state.ownerId), state.articleId, ...worldOwnerParams(state.worldId, state.ownerId)],
  );
  if (!article) throw new Error(`Article ${state.articleId} not found`);

  const existingIntro = article.introduction ?? '';
  const effectiveMode = state.heraldMode === 'improve' && existingIntro.trim().length === 0 ? 'full' : state.heraldMode;

  const heraldAgent = new HeraldAgent();
  const heraldResult = await heraldAgent.run(state.worldId, {
    articleTitle: article.title,
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    mode: effectiveMode,
    existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
    researchBrief: state.researchBrief,
    userSpec: state.userSpec,
  }, callCtx(state));

  return {
    introduction: heraldResult.output.introduction,
    tokensIn: heraldResult.tokensIn,
    tokensOut: heraldResult.tokensOut,
  };
}
