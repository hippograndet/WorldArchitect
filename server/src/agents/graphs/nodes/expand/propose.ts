import { getDbClient } from '../../../../db/client.js';
import { worldOwnerParams, worldOwnerPredicate } from '../../../../db/tenantScope.js';
import { MuseAgent } from '../../../muse.js';
import { CuratorAgent } from '../../../curator.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// propose — Muse (+ optional Curator auto-select)
// ---------------------------------------------------------------------------

/** Muse is grounding-only — world context, article identity, Researcher's brief. No userSpec: user preference enters downstream, via Curator. */
export async function museProposeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const agent = new MuseAgent();
  const result = await agent.run(state.worldId, {
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    mode: state.proposalMode!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { ideas: result.output.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/** No-op when autoSelect is off or Muse produced no ideas — mirrors director.ts's `if (autoSelect && ideas.length > 0)` guard. */
export async function curatorAutoSelectNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.autoSelect || state.ideas.length === 0) return {};

  const article = await getDbClient().get<{ title: string; template_type: string }>(
    `SELECT title, template_type FROM articles WHERE id = ? AND ${worldOwnerPredicate('articles', state.ownerId)}`,
    [state.articleId, ...worldOwnerParams(state.worldId, state.ownerId)],
  );

  const agent = new CuratorAgent();
  const result = await agent.run(state.worldId, {
    ideas: state.ideas,
    articleTitle: article?.title ?? '',
    articleTemplateType: article?.template_type ?? 'general',
    currentSummary: state.contextPackage?.targetIntroduction,
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  }, callCtx(state));

  return {
    autoSelectedIndices: result.output.selectedIndices,
    autoSelectRationale: result.output.rationale,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
