import { getDbClient } from '../../../../db/client.js';
import { ownerParams, ownerPredicate, worldOwnerParams, worldOwnerPredicate } from '../../../../db/tenantScope.js';
import { LorekeepAgent } from '../../../lorekeeper.js';
import { GroundingCheckAgent } from '../../../groundingCheck.js';
import { recordArticleIssues } from '../../../../services/issueRecorder.js';
import { callCtx } from '../shared.js';
import { buildCorrectionNote, runCheckReviseLoop } from './shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// summarize (standalone) / Inception — Lorekeeper writes the World Bible
// introduction, plus an optional Grounding Check check→revise loop
// ---------------------------------------------------------------------------

/**
 * Lorekeeper's introduction plus, when coherenceCheckLevel > 0, a bounded
 * Grounding Check check→revise loop (see runCheckReviseLoop) — same shape as
 * draft.ts's scribeNode Continuity Editor pass.
 */
export async function lorekeeperSummarizeNode(state: OrchestrationState): Promise<Partial_> {
  const article = await getDbClient().get<{ title: string; introduction: string }>(
    `SELECT a.title, av.introduction
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', state.ownerId)}
     WHERE a.id = ? AND ${worldOwnerPredicate('a', state.ownerId)}`,
    [...ownerParams(state.ownerId), state.articleId, ...worldOwnerParams(state.worldId, state.ownerId)],
  );
  if (!article) throw new Error(`Article ${state.articleId} not found`);

  const existingIntro = article.introduction ?? '';
  const effectiveMode = state.lorekeeperMode === 'improve' && existingIntro.trim().length === 0 ? 'full' : state.lorekeeperMode;

  const lorekeeperAgent = new LorekeepAgent();
  const lorekeeperResult = await lorekeeperAgent.run(state.worldId, {
    articleTitle: article.title,
    worldContext: state.worldContext!,
    mode: effectiveMode,
    existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  let tokensIn = lorekeeperResult.tokensIn;
  let tokensOut = lorekeeperResult.tokensOut;
  let introduction = lorekeeperResult.output.introduction;

  let groundingCheck: Partial_['groundingCheck'];
  if (state.coherenceCheckLevel > 0) {
    const gcAgent = new GroundingCheckAgent();

    const loopResult = await runCheckReviseLoop({
      level: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      initialDraft: introduction,
      check: async (draft) => {
        const gcResult = await gcAgent.run(state.worldId, {
          worldContext: state.worldContext!,
          articleTitle: article.title,
          draft,
          researchBrief: state.researchBrief,
        }, callCtx(state));
        return { output: gcResult.output, tokensIn: gcResult.tokensIn, tokensOut: gcResult.tokensOut };
      },
      revise: async (_draft, correctionNote) => {
        const revisionResult = await lorekeeperAgent.run(state.worldId, {
          articleTitle: article.title,
          worldContext: state.worldContext!,
          mode: effectiveMode,
          existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
          revisionNotes: correctionNote,
          researchBrief: state.researchBrief,
        }, callCtx(state));
        return { draft: revisionResult.output.introduction, tokensIn: revisionResult.tokensIn, tokensOut: revisionResult.tokensOut };
      },
      onFlagged: async (check) => {
        if (!state.ownerId) return;
        await recordArticleIssues(getDbClient(), {
          worldId: state.worldId,
          ownerId: state.ownerId,
          articleId: state.articleId!,
          source: 'grounding_check',
          issues: [{
            severity: 'info',
            code: 'GROUNDING_UNRESOLVED_AFTER_SAFETY_NET',
            excerpt: check.contradictions[0]?.excerpt ?? null,
            explanation: `Grounding Check still flagged contradictions after the safety-net pass: ${buildCorrectionNote(check.contradictions)}`,
          }],
        });
      },
    });
    tokensIn += loopResult.tokensIn;
    tokensOut += loopResult.tokensOut;
    introduction = loopResult.draft;
    groundingCheck = loopResult.lastCheck;
  }

  return {
    introduction,
    ...(groundingCheck ? { groundingCheck } : {}),
    tokensIn,
    tokensOut,
  };
}
