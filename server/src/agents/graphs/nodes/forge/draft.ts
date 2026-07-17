import { getDbClient } from '../../../../db/client.js';
import { ScribeAgent } from '../../../scribe.js';
import { ArbiterAgent } from '../../../arbiter.js';
import { StylizerAgent } from '../../../stylizer.js';
import { recordArticleIssues } from '../../../../services/issueRecorder.js';
import { callCtx } from '../shared.js';
import { buildCorrectionNote, runCheckReviseLoop } from './shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// expand — Scribe [-> Arbiter self-correction loop] -> optional
// Herald passthrough -> optional Stylizer
// ---------------------------------------------------------------------------

/**
 * Scribe's draft plus, when coherenceCheckLevel > 0 and mode isn't
 * 'reorganize', a bounded Arbiter check→revise loop (see
 * runCheckReviseLoop) — kept as one node (not split into separate graph
 * nodes/edges) since it's a tight, single-purpose loop internal to producing
 * one draft, not a multi-step pipeline stage in its own right.
 */
export async function scribeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const scribeAgent = new ScribeAgent();
  const scribeFields = {
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    mode: state.expanderMode!,
    scribeMode: state.scribeMode,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    currentDescription: pkg.targetDescription || undefined,
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

  let arbiterCheck: Partial_['arbiterCheck'];
  if (state.coherenceCheckLevel > 0 && state.expanderMode !== 'reorganize') {
    const arbiterAgent = new ArbiterAgent();
    const currentDraft = () => (scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description);

    const loopResult = await runCheckReviseLoop({
      level: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      initialDraft: currentDraft(),
      check: async (draft) => {
        const arbiterResult = await arbiterAgent.run(state.worldId, {
          worldInfoContext: state.worldInfoContext!,
          articleTitle: pkg.targetTitle,
          draft,
          researchBrief: state.researchBrief!,
          userSpec: state.userSpec,
        }, callCtx(state));
        return { output: arbiterResult.output, tokensIn: arbiterResult.tokensIn, tokensOut: arbiterResult.tokensOut };
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
            explanation: `Arbiter still flagged contradictions after the safety-net pass: ${buildCorrectionNote(check.contradictions)}`,
          }],
        });
      },
    });
    tokensIn += loopResult.tokensIn;
    tokensOut += loopResult.tokensOut;
    arbiterCheck = loopResult.lastCheck;
  }

  const description = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
  const parentAppend = scribeOutput.mode === 'child' ? scribeOutput.parentAppend : undefined;

  return {
    scribeOutput,
    description,
    ...(parentAppend ? { parentUpdate: { appendText: parentAppend } } : {}),
    mentions: [],
    ...(arbiterCheck ? { arbiterCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

/**
 * Only runs for pipelineType === 'create_child' — mirrors director.ts's
 * expand() guard. Scribe's childDescription is already intro-shaped (~80
 * words, explicitly written to become the Introduction — see expander.ts's
 * create_child system prompt), so this uses it directly instead of routing
 * it through Herald: distilling a Description isn't Herald's job,
 * and Scribe already wrote something intro-shaped with full context. Zero
 * extra LLM call versus the previous "Scribe writes childDescription, then
 * Herald re-summarizes it" shape.
 *
 * Runs *after* stylizerNode in the graph (pipelines/forge.ts's edges) —
 * Stylizer rewrites state.description in place, so reading it here first
 * would otherwise copy the stale pre-rewrite draft into the introduction.
 */
export async function deriveIntroFromChildDescriptionNode(state: OrchestrationState): Promise<Partial_> {
  if (state.expanderMode !== 'create_child') return {};
  return { introduction: state.description! };
}

/**
 * Only runs when runStylizer is on — reused by expand(). Rewrites
 * state.description in place with Stylizer's output (a direct rewrite,
 * not an advisory check) — see stylizer.ts's class docstring.
 */
export async function stylizerNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.runStylizer) return {};

  const content = state.description!;
  const contentLabel = 'Description';

  const agent = new StylizerAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    content,
    contentLabel,
    worldInfoContext: state.worldInfoContext!,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  }, callCtx(state));
  return {
    description: result.output.description,
    styleCheck: result.output,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
