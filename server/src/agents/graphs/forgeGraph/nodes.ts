import { getDbClient } from '../../../db/client.js';
import { upsertEntry } from '../../../services/worldBible.js';
import { acceptDraft, batchCreateChildArticles } from '../../../services/articlesService.js';
import { getRun, bumpRunBudget, updateRunProgress } from '../../../services/runsService.js';
import { recordArticleIssues } from '../../../services/issueRecorder.js';
import { createRunReviewItem, getLatestReviewDecision } from '../../../services/runReviewItems.js';
import { buildContextPackage } from '../../../services/archivist.js';
import { runResearchGraph } from '../pipelines/research.js';
import { runSummarizeGraph } from '../pipelines/summarize.js';
import { runProposeGraph } from '../pipelines/propose.js';
import { runExpandGraph } from '../pipelines/expand.js';
import { runProposeChildrenGraph } from '../pipelines/proposeChildren.js';
import {
  isFatal,
  errorMessage,
  countWords,
  getCurrentIntro,
  getCurrentDescription,
  getChildCount,
  resolveItemContextPackage,
  logEvent,
  requiresUserReview,
  stringDecision,
  stringPayload,
  selectedChildrenDecision,
  payloadChildren,
  selectedIdeasDecision,
  persistExpandDraft,
} from './helpers.js';
import type { ForgeState, ForgeQueueItem } from '../forgeState.js';

// ---------------------------------------------------------------------------
// Nodes — one per Forge step, cascading exactly like forgeSlice.ts's
// runForgeLoop: inception (if startStep === 'inception') falls into expansion
// (if startStep !== 'branching') falls into branching (if depth < maxDepth).
// Each node wraps its own body in try/catch so a non-fatal error only skips
// the rest of *this* item (routed to finishItem) while a fatal one ends the
// whole run — same classification/behavior as the original loop's catch block.
// ---------------------------------------------------------------------------

export async function dequeueNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const run = await getRun(state.worldId, state.ownerId, state.runId);
  if (!run || run.status === 'stopped') return { signal: 'stopped' };
  if (run.status === 'paused') return { signal: 'paused' };

  // A resume after a crash mid-cascade checkpoints with currentItem still
  // set (its steps not all done yet) — continue that item instead of
  // silently dropping it and popping the next one off the queue.
  if (state.currentItem) return { signal: 'continue' };

  if (state.queue.length === 0) return { signal: 'completed' };

  const [item, ...rest] = state.queue;
  return {
    currentItem: item,
    queue: rest,
    signal: 'continue',
    lastStepError: undefined,
    inceptionIntro: undefined,
    currentItemStepsDone: [],
    currentItemContextPackage: undefined,
    currentItemResearchBrief: undefined,
  };
}

/**
 * Unconditional prefix step run once per queue item, before Inception,
 * Expansion, or Branching do any of their own conditional work — even when
 * startStep skips straight to 'expansion'/'branching' and Inception never
 * runs for this item. Researcher's output (a free-text research brief) only
 * depends on {contextPackage, worldContext}, not on any proposal/direction
 * chosen downstream, so it can run first and be
 * shared by every consumer (Muse, Cartographer, Oracle, Scribe) instead of
 * being re-derived inside Expansion alone.
 *
 * Deliberately does NOT set lastStepError on a non-fatal failure (unlike
 * inceptionNode/expansionNode/branchingNode, which do): downstream steps
 * already tolerate a missing currentItemResearchBrief/currentItemContextPackage
 * by building their own, so a Research hiccup shouldn't count as a failed
 * step for an otherwise fully-successful item.
 */
export async function researchNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (state.currentItemResearchBrief) return {};

  try {
    const result = await runResearchGraph({
      worldId: state.worldId,
      ownerId: state.ownerId,
      articleId: item.articleId,
      contextDepth: state.contextDepth,
      pipelineRunId: state.runId,
      worldContext: state.worldContext,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, result.tokensIn + result.tokensOut);
    await logEvent(state, 'Research', item.title, true, 'Research brief ready.');
    return {
      currentItemContextPackage: result.contextPackage,
      currentItemResearchBrief: result.researchBrief,
    };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Research', item.title, false, errorMessage(err));
    return fatal
      ? { signal: 'error' as const, lastStepError: { step: 'Research', fatal: true, message: errorMessage(err) } }
      : {};
  }
}

export async function inceptionNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.startStep !== 'inception' || state.currentItemStepsDone.includes('inception')) return {};

  try {
    const existingIntro = await getCurrentIntro(state.worldId, state.ownerId, item.articleId);
    const hasExistingIntro = existingIntro.trim().length > 0;
    if (hasExistingIntro && (state.forgeInceptionExistingMode === 'skip_existing' || state.forgeInceptionExistingMode === 'create')) {
      await logEvent(state, 'Inception', item.title, true, 'Skipped existing introduction.');
      return {
        inceptionIntro: existingIntro,
        currentItemStepsDone: [...state.currentItemStepsDone, 'inception'],
        currentItemContextPackage: await resolveItemContextPackage(state, item.articleId, existingIntro),
      };
    }

    const existingDecision = requiresUserReview(state)
      ? await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'intro_review',
      })
      : null;
    if (existingDecision?.status === 'rejected') {
      await logEvent(state, 'Inception', item.title, false, 'Introduction rejected by user.');
      return { signal: 'continue', lastStepError: { step: 'Inception', fatal: false, message: 'Introduction rejected by user.' } };
    }
    if (existingDecision?.status === 'accepted') {
      const acceptedIntro = stringDecision(existingDecision, 'introduction', stringPayload(existingDecision, 'introduction', existingIntro));
      await upsertEntry(getDbClient(), state.worldId, item.articleId, acceptedIntro);
      await logEvent(state, 'Inception', item.title, true, 'Introduction accepted and saved.');
      return {
        signal: 'continue',
        inceptionIntro: acceptedIntro,
        currentItemStepsDone: [...state.currentItemStepsDone, 'inception'],
        currentItemContextPackage: await resolveItemContextPackage(state, item.articleId, acceptedIntro),
      };
    }

    const summarizeMode = state.forgeInceptionExistingMode === 'improve' ? 'improve' : 'full';
    const result = await runSummarizeGraph({
      worldId: state.worldId,
      ownerId: state.ownerId,
      articleId: item.articleId,
      mode: summarizeMode,
      pipelineRunId: state.runId,
      coherenceCheckLevel: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      worldContext: state.worldContext,
      contextPackage: state.currentItemContextPackage,
      researchBrief: state.currentItemResearchBrief,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, result.tokensIn + result.tokensOut);

    // Grounding Check (when on) already ran once and gave Lorekeeper one
    // revision attempt inside runSummarizeGraph — that revision is trusted
    // without a second verification pass or a commit-blocking gate here.
    // Deeper checking of the committed introduction happens in Consolidate
    // (Linter, Warden), not by refusing to commit at all.

    const introWordCount = countWords(result.introduction);
    if (introWordCount < 15) {
      const message = `Inception generated only ${introWordCount} word${introWordCount === 1 ? '' : 's'}; expected at least 15 words for a usable introduction. Nothing was saved.`;
      await logEvent(state, 'Inception', item.title, false, message);
      return { lastStepError: { step: 'Inception', fatal: false, message } };
    }

    if (requiresUserReview(state)) {
      const decision = await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'intro_review',
      });
      if (!decision) {
        await createRunReviewItem({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          step: 'Inception',
          kind: 'intro_review',
          payload: { title: item.title, introduction: result.introduction, wordCount: introWordCount },
        });
        await logEvent(state, 'Inception', item.title, true, 'Introduction ready for review.');
        return { signal: 'needs_input' };
      }
      if (decision.status === 'rejected') {
        await logEvent(state, 'Inception', item.title, false, 'Introduction rejected by user.');
        return { signal: 'continue', lastStepError: { step: 'Inception', fatal: false, message: 'Introduction rejected by user.' } };
      }
      const acceptedIntro = stringDecision(decision, 'introduction', result.introduction);
      await upsertEntry(getDbClient(), state.worldId, item.articleId, acceptedIntro);
      await logEvent(state, 'Inception', item.title, true, 'Introduction accepted and saved.');
      return {
        signal: 'continue',
        inceptionIntro: acceptedIntro,
        currentItemStepsDone: [...state.currentItemStepsDone, 'inception'],
        currentItemContextPackage: await resolveItemContextPackage(state, item.articleId, acceptedIntro, result.contextPackage),
      };
    }

    await upsertEntry(getDbClient(), state.worldId, item.articleId, result.introduction);
    await logEvent(state, 'Inception', item.title, true, `Saved ${introWordCount}-word introduction.`);
    return {
      inceptionIntro: result.introduction,
      currentItemStepsDone: [...state.currentItemStepsDone, 'inception'],
      currentItemContextPackage: await resolveItemContextPackage(state, item.articleId, result.introduction, result.contextPackage),
    };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Inception', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Inception', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

export async function expansionNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.startStep === 'branching' || state.currentItemStepsDone.includes('expansion')) return {};

  try {
    const existingDescription = await getCurrentDescription(state.ownerId, item.articleId);
    if (existingDescription.trim() && (state.forgeExpansionExistingMode === 'skip_existing' || state.forgeExpansionExistingMode === 'create')) {
      await logEvent(state, 'Expansion', item.title, true, 'Skipped existing description.');
      return { currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    const existingDecision = requiresUserReview(state)
      ? await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'draft_review',
      })
      : null;
    if (existingDecision?.status === 'rejected') {
      await logEvent(state, 'Expansion', item.title, false, 'Draft rejected by user.');
      return { signal: 'continue', lastStepError: { step: 'Expansion', fatal: false, message: 'Draft rejected by user.' } };
    }
    if (existingDecision?.status === 'accepted') {
      const acceptedDescription = stringDecision(existingDecision, 'description', stringPayload(existingDecision, 'description', existingDescription));
      await persistExpandDraft({
        worldId: state.worldId,
        articleId: item.articleId,
        ownerId: state.ownerId,
        description: acceptedDescription,
        runId: state.runId,
        contextBasis: state.contextBasis,
        contextDraftIds: state.currentItemContextPackage?.contextDraftIds ?? [],
      });
      await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });
      await logEvent(state, 'Expansion', item.title, true, 'Draft accepted and saved.');
      return { signal: 'continue', currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    const ideaDecision = requiresUserReview(state)
      ? await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'idea_selection',
      })
      : null;
    if (ideaDecision?.status === 'rejected') {
      await logEvent(state, 'Expansion', item.title, false, 'Expansion themes rejected by user.');
      return { signal: 'continue', lastStepError: { step: 'Expansion', fatal: false, message: 'Expansion themes rejected by user.' } };
    }

    // Reuses Inception's cached package (patched with the fresh intro) when
    // this item's cascade included Inception; otherwise builds fresh here.
    // Shared across every sub-pipeline call below — Muse/Curator and
    // Researcher/Scribe all otherwise rebuild the same 'default'-mode package
    // back-to-back with nothing in between to invalidate it.
    const contextPackage = state.currentItemContextPackage
      ?? await buildContextPackage(state.worldId, item.articleId, {
        mode: 'default',
        contextDepth: state.contextDepth,
        contextBasis: state.contextBasis,
        ownerId: state.ownerId,
      });

    let selectedIdeas = selectedIdeasDecision(ideaDecision);
    if (!ideaDecision) {
      const proposeResult = await runProposeGraph({
        worldId: state.worldId,
        ownerId: state.ownerId,
        articleId: item.articleId,
        pipelineType: 'expand_description',
        autoSelect: !requiresUserReview(state),
        contextDepth: state.contextDepth,
        contextBasis: state.contextBasis,
        pipelineRunId: state.runId,
        worldContext: state.worldContext,
        contextPackage,
        researchBrief: state.currentItemResearchBrief,
      });
      await bumpRunBudget(state.worldId, state.ownerId, state.runId, proposeResult.tokensIn + proposeResult.tokensOut);
      const suggestedIndices = proposeResult.autoSelectedIndices ?? [];

      if (requiresUserReview(state)) {
        await createRunReviewItem({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          step: 'Expansion',
          kind: 'idea_selection',
          payload: { title: item.title, ideas: proposeResult.ideas, suggestedIndices },
        });
        await logEvent(state, 'Expansion', item.title, true, 'Expansion themes ready for selection.');
        return { signal: 'needs_input' };
      }

      selectedIdeas = suggestedIndices.map((i) => proposeResult.ideas[i]).filter((idea): idea is typeof proposeResult.ideas[number] => Boolean(idea));
    }

    const expandResult = await runExpandGraph({
      worldId: state.worldId,
      ownerId: state.ownerId,
      articleId: item.articleId,
      pipelineType: 'expand_description',
      contextDepth: state.contextDepth,
      contextBasis: state.contextBasis,
      selectedIdeas,
      userSpec: state.forgeExpansionExistingMode === 'replace'
        ? 'Replace the current description completely. Do not preserve old wording unless it is required by established world facts.'
        : undefined,
      coherenceCheckLevel: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      pipelineRunId: state.runId,
      worldContext: state.worldContext,
      contextPackage,
      researchBrief: state.currentItemResearchBrief,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, expandResult.tokensIn + expandResult.tokensOut);

    if (requiresUserReview(state)) {
      const decision = await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'draft_review',
      });
      if (!decision) {
        await createRunReviewItem({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          step: 'Expansion',
          kind: 'draft_review',
          payload: {
            title: item.title,
            description: expandResult.description,
            ideas: selectedIdeas ?? [],
          },
        });
        await logEvent(state, 'Expansion', item.title, true, 'Draft ready for review.');
        return { signal: 'needs_input' };
      }
      if (decision.status === 'rejected') {
        await logEvent(state, 'Expansion', item.title, false, 'Draft rejected by user.');
        return { signal: 'continue', lastStepError: { step: 'Expansion', fatal: false, message: 'Draft rejected by user.' } };
      }
      const acceptedDescription = stringDecision(decision, 'description', expandResult.description);
      await persistExpandDraft({
        worldId: state.worldId,
        articleId: item.articleId,
        ownerId: state.ownerId,
        description: acceptedDescription,
        runId: state.runId,
        contextBasis: state.contextBasis,
        contextDraftIds: expandResult.contextDraftIds ?? contextPackage.contextDraftIds ?? [],
      });
      await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });
      await logEvent(state, 'Expansion', item.title, true, 'Draft accepted and saved.');
      return { signal: 'continue', currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    await persistExpandDraft({
      worldId: state.worldId,
      articleId: item.articleId,
      ownerId: state.ownerId,
      description: expandResult.description,
      runId: state.runId,
      contextBasis: state.contextBasis,
      contextDraftIds: expandResult.contextDraftIds ?? contextPackage.contextDraftIds ?? [],
    });

    if (state.commitPolicy === 'auto_commit') {
      await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });
      await logEvent(state, 'Expansion', item.title, true, 'Description saved.');
    } else {
      await logEvent(state, 'Expansion', item.title, true, 'Draft ready for review.');
    }
    return { currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Expansion', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Expansion', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

export async function branchingNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.depth >= state.forgeMaxDepth || state.currentItemStepsDone.includes('branching')) return {};

  try {
    const existingChildren = await getChildCount(state.ownerId, item.articleId);
    if (existingChildren > 0 && state.forgeBranchingExistingMode === 'skip_if_children') {
      await logEvent(state, 'Branching', item.title, true, `Skipped branching because ${existingChildren} child article${existingChildren === 1 ? '' : 's'} already exist.`);
      return { currentItemStepsDone: [...state.currentItemStepsDone, 'branching'] };
    }

    const existingDecision = requiresUserReview(state)
      ? await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'child_selection',
      })
      : null;
    if (existingDecision?.status === 'rejected') {
      await logEvent(state, 'Branching', item.title, false, 'Child proposals rejected by user.');
      return { signal: 'continue', lastStepError: { step: 'Branching', fatal: false, message: 'Child proposals rejected by user.' } };
    }
    if (existingDecision?.status === 'accepted') {
      const approvedChildren = selectedChildrenDecision(existingDecision, payloadChildren(existingDecision));
      const batchResult = approvedChildren.length > 0 ? await batchCreateChildArticles({
        worldId: state.worldId,
        ownerId: state.ownerId,
        parentArticleId: item.articleId,
        children: approvedChildren.map((p) => ({ title: p.title, introduction: p.introduction, templateType: p.templateType })),
      }) : { created: [] };
      const newItems: ForgeQueueItem[] = batchResult.created.map((c) => ({
        articleId: c.id,
        title: c.title,
        depth: item.depth + 1,
        startStep: 'inception' as const,
      }));
      const shouldQueueChildren = state.forgeContinuationMode === 'recursive';
      await logEvent(state, 'Branching', item.title, true, `Created ${newItems.length} child article${newItems.length === 1 ? '' : 's'}.`);
      const total = shouldQueueChildren ? state.total + newItems.length : state.total;
      await updateRunProgress(state.worldId, state.ownerId, state.runId, state.completed, total);
      return {
        signal: 'continue',
        queue: shouldQueueChildren
          ? (state.forgeMode === 'breadth' ? [...state.queue, ...newItems] : [...newItems, ...state.queue])
          : state.queue,
        total,
        currentItemStepsDone: [...state.currentItemStepsDone, 'branching'],
      };
    }

    const branchHint = state.branchingMode === 'specific'
      ? 'Prefer specific named instances (individual entities, real examples). '
      : 'Prefer conceptual categories and systems. ';

    const childResult = await runProposeChildrenGraph({
      worldId: state.worldId,
      ownerId: state.ownerId,
      articleId: item.articleId,
      contextDepth: state.contextDepth,
      userSpec: branchHint,
      pipelineRunId: state.runId,
      coherenceCheckLevel: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      worldContext: state.worldContext,
      // No contextPackage here — Branching always rebuilds its own under
      // 'propose_children' mode (see runProposeChildrenGraph's comment).
      researchBrief: state.currentItemResearchBrief,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, childResult.tokensIn + childResult.tokensOut);

    if (childResult.dedupCheck?.duplicates.length) {
      await recordArticleIssues(getDbClient(), {
        worldId: state.worldId,
        ownerId: state.ownerId,
        articleId: item.articleId,
        source: 'dedup_check',
        issues: childResult.dedupCheck.duplicates.map((d) => ({
          severity: 'info',
          code: 'DUPLICATE_PROPOSAL_FILTERED',
          explanation: `Proposed child "${d.proposalTitle}" filtered as a likely duplicate of existing article "${d.matchedExisting}": ${d.rationale}`,
        })),
      });
    }

    // childResult.proposals already has any flagged duplicates filtered out
    // by cartographerNode itself — no additional filtering needed here.
    const take = state.forgeMaxChildren > 0
      ? childResult.proposals.slice(0, state.forgeMaxChildren)
      : childResult.proposals;

    if (requiresUserReview(state)) {
      const decision = await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'child_selection',
      });
      if (!decision) {
        await createRunReviewItem({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          step: 'Branching',
          kind: 'child_selection',
          payload: { title: item.title, children: take },
        });
        await logEvent(state, 'Branching', item.title, true, 'Child proposals ready for review.');
        return { signal: 'needs_input' };
      }
      if (decision.status === 'rejected') {
        await logEvent(state, 'Branching', item.title, false, 'Child proposals rejected by user.');
        return { signal: 'continue', lastStepError: { step: 'Branching', fatal: false, message: 'Child proposals rejected by user.' } };
      }
    }

    const approvedChildren = requiresUserReview(state)
      ? selectedChildrenDecision(
        await getLatestReviewDecision({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          kind: 'child_selection',
        }),
        take,
      )
      : take;

    const batchResult = approvedChildren.length > 0 ? await batchCreateChildArticles({
      worldId: state.worldId,
      ownerId: state.ownerId,
      parentArticleId: item.articleId,
      children: approvedChildren.map((p) => ({ title: p.title, introduction: p.introduction, templateType: p.templateType })),
    }) : { created: [] };

    const newItems: ForgeQueueItem[] = batchResult.created.map((c) => ({
      articleId: c.id,
      title: c.title,
      depth: item.depth + 1,
      startStep: 'inception' as const,
    }));

    const shouldQueueChildren = state.forgeContinuationMode === 'recursive';
    await logEvent(state, 'Branching', item.title, true, `Created ${newItems.length} child article${newItems.length === 1 ? '' : 's'}.`);
    const total = shouldQueueChildren ? state.total + newItems.length : state.total;
    await updateRunProgress(state.worldId, state.ownerId, state.runId, state.completed, total);
    return {
      signal: 'continue',
      queue: shouldQueueChildren
        ? (state.forgeMode === 'breadth' ? [...state.queue, ...newItems] : [...newItems, ...state.queue])
        : state.queue,
      total,
      currentItemStepsDone: [...state.currentItemStepsDone, 'branching'],
    };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Branching', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Branching', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

export async function finishItemNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const completed = state.completed + 1;
  // Fatal errors never reach this node (they route straight to END_KEY), so any
  // lastStepError here is non-fatal — the item was still counted "completed"
  // for progress purposes, but its step failed and finalizeRun needs to know.
  const failedItemCount = state.failedItemCount + (state.lastStepError ? 1 : 0);
  await updateRunProgress(state.worldId, state.ownerId, state.runId, completed, state.total);
  return { completed, failedItemCount, currentItem: undefined, currentItemStepsDone: [] };
}
