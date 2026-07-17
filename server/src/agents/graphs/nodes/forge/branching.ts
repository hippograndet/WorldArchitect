import { getDbClient } from '../../../../db/client.js';
import { CartographerAgent } from '../../../cartographer.js';
import { GatekeeperAgent } from '../../../gatekeeper.js';
import { recordArticleIssues } from '../../../../services/issueRecorder.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// propose_children / Branching — Cartographer (+ Gatekeeper loop)
// ---------------------------------------------------------------------------

/**
 * Cartographer's proposals plus, when coherenceCheckLevel > 0, a Gatekeeper
 * loop that filters out proposals flagged as semantic duplicates of existing
 * siblings and, if cycles remain, re-runs Cartographer for fresh
 * replacements (excluding what's already known) — shared by both the manual
 * "propose children" flow and the recursive Forge run's branchingNode, since
 * both invoke the same graph. Gatekeeper's
 * shape (filter a list + regenerate) doesn't fit runCheckReviseLoop's
 * single-draft check/revise contract, so it has its own loop here.
 *
 * Filtering out a flagged duplicate always happens, even on the final
 * safety-net pass — there's no reason to keep a known duplicate just because
 * cycles ran out. The safety-net's "flag, don't block" behavior instead means
 * the resulting list may end up shorter than requested, and that gets
 * recorded via recordArticleIssues so Consolidate/the UI can see fewer
 * children were produced than asked for.
 */
export async function cartographerNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const existingChildren = pkg.children.map((c) => ({ title: c.title, summary: c.summary }));

  const agent = new CartographerAgent();
  const result = await agent.run(state.worldId, {
    worldInfoContext: state.worldInfoContext!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    currentDescription: pkg.targetDescription || undefined,
    existingChildren,
    userSpec: state.userSpec,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  let tokensIn = result.tokensIn;
  let tokensOut = result.tokensOut;
  let childProposals = result.output.proposals;

  let gatekeeperCheck: Partial_['gatekeeperCheck'];
  if (state.coherenceCheckLevel > 0 && childProposals.length > 0) {
    const gatekeeperAgent = new GatekeeperAgent();
    const level = state.coherenceCheckLevel;

    for (let cycle = 0; cycle < level && childProposals.length > 0; cycle++) {
      const gatekeeperResult = await gatekeeperAgent.run(state.worldId, {
        articleTitle: pkg.targetTitle,
        existingChildren,
        proposals: childProposals,
        userSpec: state.userSpec,
      }, callCtx(state));
      tokensIn += gatekeeperResult.tokensIn;
      tokensOut += gatekeeperResult.tokensOut;
      gatekeeperCheck = gatekeeperResult.output;

      if (gatekeeperCheck.duplicates.length === 0) break;

      const flaggedTitles = new Set(gatekeeperCheck.duplicates.map((d) => d.proposalTitle));
      childProposals = childProposals.filter((p) => !flaggedTitles.has(p.title));

      if (cycle >= level - 1) break;
      const regenResult = await agent.run(state.worldId, {
        worldInfoContext: state.worldInfoContext!,
        articleTitle: pkg.targetTitle,
        templateType: pkg.targetTemplateType,
        currentIntroduction: pkg.targetIntroduction || undefined,
        currentDescription: pkg.targetDescription || undefined,
        existingChildren: [...existingChildren, ...childProposals.map((p) => ({ title: p.title, summary: p.introduction }))],
        userSpec: state.userSpec,
        researchBrief: state.researchBrief,
      }, callCtx(state));
      tokensIn += regenResult.tokensIn;
      tokensOut += regenResult.tokensOut;
      childProposals = [...childProposals, ...regenResult.output.proposals];
    }

    if (state.safetyNet) {
      const finalCheck = await gatekeeperAgent.run(state.worldId, {
        articleTitle: pkg.targetTitle,
        existingChildren,
        proposals: childProposals,
        userSpec: state.userSpec,
      }, callCtx(state));
      tokensIn += finalCheck.tokensIn;
      tokensOut += finalCheck.tokensOut;
      gatekeeperCheck = finalCheck.output;

      if (gatekeeperCheck.duplicates.length > 0) {
        const flaggedTitles = new Set(gatekeeperCheck.duplicates.map((d) => d.proposalTitle));
        childProposals = childProposals.filter((p) => !flaggedTitles.has(p.title));
        if (state.ownerId) {
          await recordArticleIssues(getDbClient(), {
            worldId: state.worldId,
            ownerId: state.ownerId,
            articleId: state.articleId!,
            source: 'dedup_check',
            issues: gatekeeperCheck.duplicates.map((d) => ({
              severity: 'info',
              code: 'DUPLICATE_PROPOSAL_UNRESOLVED_AFTER_SAFETY_NET',
              explanation: `Proposed child "${d.proposalTitle}" filtered as a likely duplicate of existing article "${d.matchedExisting}" after the safety-net pass: ${d.rationale}`,
            })),
          });
        }
      }
    }
  }

  return {
    childProposals,
    ...(gatekeeperCheck ? { gatekeeperCheck } : {}),
    tokensIn,
    tokensOut,
  };
}
