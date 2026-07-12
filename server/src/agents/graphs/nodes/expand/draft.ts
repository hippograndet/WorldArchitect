import { getDbClient } from '../../../../db/client.js';
import { ScribeAgent } from '../../../scribe.js';
import { ContinuityEditorAgent } from '../../../continuityEditor.js';
import { StyleWardenAgent } from '../../../styleWarden.js';
import { recordArticleIssues } from '../../../../services/issueRecorder.js';
import { callCtx } from '../shared.js';
import { buildCorrectionNote, runCheckReviseLoop } from './shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// expand — Scribe [-> ContinuityEditor self-correction loop] -> optional
// Lorekeeper passthrough -> optional StyleWarden
// ---------------------------------------------------------------------------

/**
 * Scribe's draft plus, when coherenceCheckLevel > 0 and mode isn't
 * 'reorganize', a bounded Continuity Editor check→revise loop (see
 * runCheckReviseLoop) — kept as one node (not split into separate graph
 * nodes/edges) since it's a tight, single-purpose loop internal to producing
 * one draft, not a multi-step pipeline stage in its own right.
 */
export async function scribeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const scribeAgent = new ScribeAgent();
  const scribeFields = {
    worldContext: state.worldContext!,
    mode: state.expanderMode!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    currentDescription: pkg.targetDescription || undefined,
    currentChronology: pkg.targetChronology || undefined,
    selectedIdeas: state.selectedIdeas,
    researchBrief: state.researchBrief,
    wordCountPreset: state.wordCountPreset,
  };
  const expandResult = await scribeAgent.run(state.worldId, {
    ...scribeFields,
    userSpec: state.userSpec,
  }, callCtx(state));
  let tokensIn = expandResult.tokensIn;
  let tokensOut = expandResult.tokensOut;
  let scribeOutput = expandResult.output;

  let continuityCheck: Partial_['continuityCheck'];
  if (state.coherenceCheckLevel > 0 && state.expanderMode !== 'reorganize') {
    const ceAgent = new ContinuityEditorAgent();
    const currentDraft = () => (scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description);

    const loopResult = await runCheckReviseLoop({
      level: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      initialDraft: currentDraft(),
      check: async (draft) => {
        const ceResult = await ceAgent.run(state.worldId, {
          worldContext: state.worldContext!,
          articleTitle: pkg.targetTitle,
          draft,
          researchBrief: state.researchBrief!,
        }, callCtx(state));
        return { output: ceResult.output, tokensIn: ceResult.tokensIn, tokensOut: ceResult.tokensOut };
      },
      revise: async (_draft, correctionNote) => {
        const revisionResult = await scribeAgent.run(state.worldId, {
          ...scribeFields,
          userSpec: [state.userSpec, `\n\n## Revision Required\nPlease correct the following contradictions:\n${correctionNote}`]
            .filter(Boolean).join(''),
        }, callCtx(state));
        scribeOutput = revisionResult.output;
        return { draft: currentDraft(), tokensIn: revisionResult.tokensIn, tokensOut: revisionResult.tokensOut };
      },
      onFlagged: async (check) => {
        if (!state.ownerId) return;
        await recordArticleIssues(getDbClient(), {
          worldId: state.worldId,
          ownerId: state.ownerId,
          articleId: state.articleId!,
          source: 'continuity_editor',
          issues: [{
            severity: 'info',
            code: 'CONTINUITY_UNRESOLVED_AFTER_SAFETY_NET',
            excerpt: check.contradictions[0]?.excerpt ?? null,
            explanation: `Continuity Editor still flagged contradictions after the safety-net pass: ${buildCorrectionNote(check.contradictions)}`,
          }],
        });
      },
    });
    tokensIn += loopResult.tokensIn;
    tokensOut += loopResult.tokensOut;
    continuityCheck = loopResult.lastCheck;
  }

  const description = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
  const parentAppend = scribeOutput.mode === 'child' ? scribeOutput.parentAppend : undefined;

  return {
    scribeOutput,
    description,
    ...(parentAppend ? { parentUpdate: { appendText: parentAppend } } : {}),
    mentions: [],
    ...(continuityCheck ? { continuityCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

/**
 * Only runs for pipelineType === 'create_child' — mirrors director.ts's
 * expand() guard. Scribe's childDescription is already intro-shaped (~80
 * words, explicitly written to become the Introduction — see expander.ts's
 * create_child system prompt), so this uses it directly instead of routing
 * it through Lorekeeper: distilling a Description isn't Lorekeeper's job,
 * and Scribe already wrote something intro-shaped with full context. Zero
 * extra LLM call versus the previous "Scribe writes childDescription, then
 * Lorekeeper re-summarizes it" shape.
 */
export async function lorekeeperSummarizeAfterExpandNode(state: OrchestrationState): Promise<Partial_> {
  if (state.expanderMode !== 'create_child') return {};
  return { introduction: state.description! };
}

/** Only runs when runStyleWarden is on — reused by expand(). */
export async function styleWardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.runStyleWarden) return {};

  const content = state.description!;
  const contentLabel = 'Description';

  const agent = new StyleWardenAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    content,
    contentLabel,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { styleCheck: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
