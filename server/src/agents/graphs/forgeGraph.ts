import { nanoid } from 'nanoid';
import { StateGraph, GraphRecursionError } from '@langchain/langgraph';
import { getDbClient } from '../../db/client.js';
import { upsertEntry } from '../../services/worldBible.js';
import { acceptDraft, batchCreateChildArticles } from '../../services/articlesService.js';
import { getRun, markRunStatus, bumpRunBudget, releaseLocks, updateRunProgress } from '../../services/runsService.js';
import { recordArticleIssues } from '../../services/issueRecorder.js';
import { createRunReviewItem, getLatestReviewDecision } from '../../services/runReviewItems.js';
import { getCheckpointer } from '../checkpointer.js';
import { runWithUserContext } from '../../requestContext.js';
import { fetchWorldContext } from '../director.js';
import { buildContextPackage } from '../../services/archivist.js';
import { runResearchGraph } from './pipelines/research.js';
import { runSummarizeGraph } from './pipelines/summarize.js';
import { runProposeGraph } from './pipelines/propose.js';
import { runProposeIdeasGraph } from './pipelines/proposeIdeas.js';
import { runExpandGraph } from './pipelines/expand.js';
import { runProposeChildrenGraph } from './pipelines/proposeChildren.js';
import { ForgeAnnotation } from './forgeState.js';
import { contractState, expandRunContract } from './masContract.js';
import type { AutonomyMode, CommitPolicy, ReviewPolicy } from './masContract.js';
import type {
  ForgeState,
  ForgeQueueItem,
  ForgeContinuationMode,
  ForgeExistingContentMode,
  ForgeBranchingExistingMode,
} from './forgeState.js';
import type { ContextDepth, ContextPackage } from '../../services/archivist.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Same fatal-vs-recoverable classification forgeSlice.ts already used client-side. */
function isFatal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|429|authentication|unauthorized|quota/i.test(msg);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function getCurrentIntro(worldId: string, ownerId: string, articleId: string): Promise<string> {
  const row = await getDbClient().get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE world_id = ? AND owner_id = ? AND article_id = ?',
    [worldId, ownerId, articleId],
  );
  return row?.summary ?? '';
}

async function getCurrentDescription(ownerId: string, articleId: string): Promise<string> {
  const row = await getDbClient().get<{ description: string }>(
    `SELECT av.description
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id
     WHERE a.id = ? AND a.owner_id = ?`,
    [articleId, ownerId],
  );
  return row?.description ?? '';
}

async function getChildCount(ownerId: string, articleId: string): Promise<number> {
  const row = await getDbClient().get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM article_links
     WHERE source_article_id = ? AND owner_id = ? AND link_type = 'hierarchical'`,
    [articleId, ownerId],
  );
  return row?.count ?? 0;
}

/**
 * Resolves the ContextPackage to cache for Expansion right after Inception
 * commits an introduction. When `prebuilt` is given (Inception just called
 * runSummarizeGraph in this same invocation), its targetIntroduction is stale
 * — built before Lorekeeper wrote the intro — and must be patched with the
 * one that was just saved. Otherwise, fall back to researchNode's package
 * (state.currentItemContextPackage, built once before Inception ran) patched
 * the same way — this is the common skip-existing/resumed-review case, and
 * reusing it here is what keeps the whole Research→Inception→Expansion
 * cascade down to exactly one buildContextPackage call. Only when neither is
 * available (e.g. a pre-Research checkpoint being resumed) does this build
 * fresh from the DB.
 */
async function resolveItemContextPackage(
  state: ForgeState,
  articleId: string,
  introduction: string,
  prebuilt?: ContextPackage,
): Promise<ContextPackage> {
  const base = prebuilt ?? state.currentItemContextPackage;
  if (base) return { ...base, targetIntroduction: introduction };
  return buildContextPackage(state.worldId, articleId, { mode: 'default', contextDepth: state.contextDepth });
}

async function logEvent(state: Pick<ForgeState, 'runId' | 'worldId' | 'ownerId'>, step: string, title: string, ok: boolean, message?: string): Promise<void> {
  await getDbClient().run(
    `INSERT INTO run_events (id, run_id, step, title, ok, message, created_at)
     SELECT ?, r.id, ?, ?, ?, ?, ?
       FROM runs r
      WHERE r.id = ? AND r.world_id = ? AND r.owner_id = ?`,
    [nanoid(), step, title, ok ? 1 : 0, message ?? null, Date.now(), state.runId, state.worldId, state.ownerId],
  );
}

function requiresUserReview(state: ForgeState): boolean {
  return state.reviewPolicy === 'user_must_accept' || state.reviewPolicy === 'user_must_select' || state.autonomyMode === 'manual' || state.autonomyMode === 'review_each_step';
}

function stringDecision(review: Awaited<ReturnType<typeof getLatestReviewDecision>>, key: string, fallback: string): string {
  const value = review?.decision?.[key];
  return typeof value === 'string' ? value : fallback;
}

function stringPayload(review: Awaited<ReturnType<typeof getLatestReviewDecision>>, key: string, fallback: string): string {
  const value = review?.payload?.[key];
  return typeof value === 'string' ? value : fallback;
}

function selectedChildrenDecision(
  review: Awaited<ReturnType<typeof getLatestReviewDecision>>,
  fallback: Array<{ title: string; introduction: string; templateType: string }>,
): Array<{ title: string; introduction: string; templateType: string }> {
  const raw = review?.decision?.children;
  if (!Array.isArray(raw)) return fallback;
  return raw
    .filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
    .map((child) => ({
      title: typeof child.title === 'string' ? child.title : '',
      introduction: typeof child.introduction === 'string' ? child.introduction : '',
      templateType: typeof child.templateType === 'string' ? child.templateType : 'general',
    }))
    .filter((child) => child.title.trim().length > 0);
}

function payloadChildren(
  review: Awaited<ReturnType<typeof getLatestReviewDecision>>,
): Array<{ title: string; introduction: string; templateType: string }> {
  const raw = review?.payload?.children;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
    .map((child) => ({
      title: typeof child.title === 'string' ? child.title : '',
      introduction: typeof child.introduction === 'string' ? child.introduction : '',
      templateType: typeof child.templateType === 'string' ? child.templateType : 'general',
    }))
    .filter((child) => child.title.trim().length > 0);
}

function payloadProposals(review: Awaited<ReturnType<typeof getLatestReviewDecision>>): Array<{ title: string; direction: string }> {
  const raw = review?.payload?.proposals;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((proposal): proposal is Record<string, unknown> => Boolean(proposal) && typeof proposal === 'object' && !Array.isArray(proposal))
    .map((proposal) => ({
      title: typeof proposal.title === 'string' ? proposal.title : '',
      direction: typeof proposal.direction === 'string' ? proposal.direction : '',
    }))
    .filter((proposal) => proposal.title.trim().length > 0 || proposal.direction.trim().length > 0);
}

function selectedProposalDecision(
  review: Awaited<ReturnType<typeof getLatestReviewDecision>>,
  fallback?: { title: string; direction: string },
): { title: string; direction: string } | undefined {
  const raw = review?.decision?.proposal;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const proposal = raw as Record<string, unknown>;
    return {
      title: typeof proposal.title === 'string' ? proposal.title : '',
      direction: typeof proposal.direction === 'string' ? proposal.direction : '',
    };
  }
  const index = typeof review?.decision?.selectedIndex === 'number' ? review.decision.selectedIndex : 0;
  return payloadProposals(review)[index] ?? fallback;
}

function payloadIdeas(review: Awaited<ReturnType<typeof getLatestReviewDecision>>): Array<{ id: string; theme: string; detail: string }> {
  const raw = review?.payload?.ideas;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((idea): idea is Record<string, unknown> => Boolean(idea) && typeof idea === 'object' && !Array.isArray(idea))
    .map((idea, index) => ({
      id: typeof idea.id === 'string' ? idea.id : `idea-${index}`,
      theme: typeof idea.theme === 'string' ? idea.theme : '',
      detail: typeof idea.detail === 'string' ? idea.detail : '',
    }))
    .filter((idea) => idea.theme.trim().length > 0 || idea.detail.trim().length > 0);
}

function selectedIdeasDecision(
  review: Awaited<ReturnType<typeof getLatestReviewDecision>>,
): Array<{ id: string; theme: string; detail: string }> | undefined {
  if (!review || review.status === 'rejected') return undefined;
  const raw = review.decision?.ideas;
  if (!Array.isArray(raw)) return payloadIdeas(review);
  return raw
    .filter((idea): idea is Record<string, unknown> => Boolean(idea) && typeof idea === 'object' && !Array.isArray(idea))
    .map((idea, index) => ({
      id: typeof idea.id === 'string' ? idea.id : `idea-${index}`,
      theme: typeof idea.theme === 'string' ? idea.theme : '',
      detail: typeof idea.detail === 'string' ? idea.detail : '',
    }))
    .filter((idea) => idea.theme.trim().length > 0 || idea.detail.trim().length > 0);
}

/**
 * Mirrors routes/agents.ts's POST /expand handler's pending_drafts write
 * exactly (same table, same shape) so acceptDraft() — which reads from
 * pending_drafts — works unchanged. Forge only ever runs the
 * 'expand_description' pipeline type (never create_child/create_root/
 * reorganize), so the draftContent shape is always the non-child branch.
 */
async function persistExpandDraft(params: {
  articleId: string;
  ownerId: string;
  description: string;
}): Promise<void> {
  const exec = getDbClient();
  const draftContent = { description: params.description };
  const now = Date.now();
  const existing = await exec.get<{ id: string }>(
    'SELECT id FROM pending_drafts WHERE article_id = ? AND owner_id = ? AND pipeline_type = ?',
    [params.articleId, params.ownerId, 'expand_description'],
  );
  if (existing) {
    await exec.run(
      `UPDATE pending_drafts SET draft_content = ?, updated_at = ? WHERE article_id = ? AND owner_id = ? AND pipeline_type = ?`,
      [JSON.stringify(draftContent), now, params.articleId, params.ownerId, 'expand_description'],
    );
  } else {
    await exec.run(
      `INSERT INTO pending_drafts
         (id, owner_id, article_id, draft_content, pipeline_type, expansion_params, phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'expand_description', '{}', 'done', ?, ?)`,
      [nanoid(), params.ownerId, params.articleId, JSON.stringify(draftContent), now, now],
    );
  }
}

// ---------------------------------------------------------------------------
// Nodes — one per Forge step, cascading exactly like forgeSlice.ts's
// runForgeLoop: inception (if startStep === 'inception') falls into expansion
// (if startStep !== 'branching') falls into branching (if depth < maxDepth).
// Each node wraps its own body in try/catch so a non-fatal error only skips
// the rest of *this* item (routed to finishItem) while a fatal one ends the
// whole run — same classification/behavior as the original loop's catch block.
// ---------------------------------------------------------------------------

async function dequeueNode(state: ForgeState): Promise<Partial<ForgeState>> {
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
 * runs for this item. Researcher's output ({keyFacts, warnings,
 * suggestedAngles}) only depends on {contextPackage, worldContext}, not on
 * any proposal/direction chosen downstream, so it can run first and be
 * shared by every consumer (Muse, Cartographer, Oracle, Scribe) instead of
 * being re-derived inside Expansion alone.
 *
 * Deliberately does NOT set lastStepError on a non-fatal failure (unlike
 * inceptionNode/expansionNode/branchingNode, which do): downstream steps
 * already tolerate a missing currentItemResearchBrief/currentItemContextPackage
 * by building their own, so a Research hiccup shouldn't count as a failed
 * step for an otherwise fully-successful item.
 */
async function researchNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (state.currentItemResearchBrief) return {};

  try {
    const result = await runResearchGraph({
      worldId: state.worldId,
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

async function inceptionNode(state: ForgeState): Promise<Partial<ForgeState>> {
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
      articleId: item.articleId,
      mode: summarizeMode,
      pipelineRunId: state.runId,
      runGroundingCheck: state.forgeUseGroundingCheck,
      worldContext: state.worldContext,
      contextPackage: state.currentItemContextPackage,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, result.tokensIn + result.tokensOut);

    if (state.forgeUseGroundingCheck && result.groundingCheck && !result.groundingCheck.approved) {
      await recordArticleIssues(getDbClient(), {
        worldId: state.worldId,
        ownerId: state.ownerId,
        articleId: item.articleId,
        source: 'grounding_check',
        issues: result.groundingCheck.contradictions.map((c) => ({
          severity: 'warning',
          code: 'GROUNDING_CONTRADICTION',
          excerpt: c.excerpt,
          explanation: c.issue,
          suggestion: c.correction,
        })),
      });
      await logEvent(state, 'Inception', item.title, false, 'Grounding check failed after revision — introduction not grounded in parent/world context.');
      // Deliberately skip upsertEntry(): an ungrounded intro must never be
      // committed to the World Bible, since Expansion/Branching and every
      // descendant would otherwise read it as trusted context.
      return { lastStepError: { step: 'Inception', fatal: false, message: 'Grounding check failed after revision.' } };
    }

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

async function expansionNode(state: ForgeState): Promise<Partial<ForgeState>> {
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
        articleId: item.articleId,
        ownerId: state.ownerId,
        description: acceptedDescription,
      });
      await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });
      await logEvent(state, 'Expansion', item.title, true, 'Draft accepted and saved.');
      return { signal: 'continue', currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    const proposalDecision = requiresUserReview(state)
      ? await getLatestReviewDecision({
        worldId: state.worldId,
        ownerId: state.ownerId,
        runId: state.runId,
        articleId: item.articleId,
        kind: 'proposal_selection',
      })
      : null;
    if (proposalDecision?.status === 'rejected') {
      await logEvent(state, 'Expansion', item.title, false, 'Expansion direction rejected by user.');
      return { signal: 'continue', lastStepError: { step: 'Expansion', fatal: false, message: 'Expansion direction rejected by user.' } };
    }

    // Reuses Inception's cached package (patched with the fresh intro) when
    // this item's cascade included Inception; otherwise builds fresh here.
    // Shared across every sub-pipeline call below — Muse/Curator, Oracle, and
    // Researcher/Scribe all otherwise rebuild the same 'default'-mode package
    // back-to-back with nothing in between to invalidate it.
    const contextPackage = state.currentItemContextPackage
      ?? await buildContextPackage(state.worldId, item.articleId, { mode: 'default', contextDepth: state.contextDepth });

    let selectedProposal = selectedProposalDecision(proposalDecision);
    if (!selectedProposal) {
      const proposeResult = await runProposeGraph({
        worldId: state.worldId,
        articleId: item.articleId,
        pipelineType: 'expand_description',
        autoSelect: !requiresUserReview(state),
        contextDepth: state.contextDepth,
        pipelineRunId: state.runId,
        worldContext: state.worldContext,
        contextPackage,
        researchBrief: state.currentItemResearchBrief,
      });
      await bumpRunBudget(state.worldId, state.ownerId, state.runId, proposeResult.tokensIn + proposeResult.tokensOut);
      const selectedIndex = proposeResult.autoSelectedIndex ?? 0;

      if (requiresUserReview(state)) {
        await createRunReviewItem({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          step: 'Expansion',
          kind: 'proposal_selection',
          payload: { title: item.title, proposals: proposeResult.proposals, suggestedIndex: selectedIndex },
        });
        await logEvent(state, 'Expansion', item.title, true, 'Expansion directions ready for selection.');
        return { signal: 'needs_input' };
      }

      selectedProposal = proposeResult.proposals[selectedIndex];
    }
    if (!selectedProposal) {
      const message = 'No expansion direction was selected.';
      await logEvent(state, 'Expansion', item.title, false, message);
      return { signal: 'continue', lastStepError: { step: 'Expansion', fatal: false, message } };
    }

    let selectedIdeas: Awaited<ReturnType<typeof runProposeIdeasGraph>>['ideas'] | undefined;
    if (state.forgeUseOracle && state.inceptionIntro?.trim() && selectedProposal) {
      const ideaDecision = requiresUserReview(state)
        ? await getLatestReviewDecision({
          worldId: state.worldId,
          ownerId: state.ownerId,
          runId: state.runId,
          articleId: item.articleId,
          kind: 'idea_selection',
        })
        : null;
      selectedIdeas = selectedIdeasDecision(ideaDecision);
      if (!ideaDecision) {
        try {
          const ideasResult = await runProposeIdeasGraph({
            worldId: state.worldId,
            articleId: item.articleId,
            introduction: state.inceptionIntro,
            selectedProposal,
            contextDepth: state.contextDepth,
            pipelineRunId: state.runId,
            worldContext: state.worldContext,
            contextPackage,
            researchBrief: state.currentItemResearchBrief,
          });
          await bumpRunBudget(state.worldId, state.ownerId, state.runId, ideasResult.tokensIn + ideasResult.tokensOut);

          if (requiresUserReview(state)) {
            await createRunReviewItem({
              worldId: state.worldId,
              ownerId: state.ownerId,
              runId: state.runId,
              articleId: item.articleId,
              step: 'Expansion',
              kind: 'idea_selection',
              payload: { title: item.title, ideas: ideasResult.ideas, proposal: selectedProposal },
            });
            await logEvent(state, 'Expansion', item.title, true, 'Expansion themes ready for selection.');
            return { signal: 'needs_input' };
          }

          selectedIdeas = ideasResult.ideas;
        } catch {
          // Oracle failure is non-fatal — Scribe runs without ideas, same as the client loop.
        }
      }
    }

    const expandResult = await runExpandGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      pipelineType: 'expand_description',
      selectedProposal,
      contextDepth: state.contextDepth,
      selectedIdeas,
      userSpec: state.forgeExpansionExistingMode === 'replace'
        ? 'Replace the current description completely. Do not preserve old wording unless it is required by established world facts.'
        : undefined,
      runContinuityEditor: state.forgeUseContinuityEditor,
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
            proposal: selectedProposal,
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
        articleId: item.articleId,
        ownerId: state.ownerId,
        description: acceptedDescription,
      });
      await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });
      await logEvent(state, 'Expansion', item.title, true, 'Draft accepted and saved.');
      return { signal: 'continue', currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    await persistExpandDraft({
      articleId: item.articleId,
      ownerId: state.ownerId,
      description: expandResult.description,
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

async function branchingNode(state: ForgeState): Promise<Partial<ForgeState>> {
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
      articleId: item.articleId,
      contextDepth: state.contextDepth,
      userSpec: branchHint,
      pipelineRunId: state.runId,
      runDedupCheck: state.forgeUseDedupCheck,
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

async function finishItemNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const completed = state.completed + 1;
  // Fatal errors never reach this node (they route straight to END_KEY), so any
  // lastStepError here is non-fatal — the item was still counted "completed"
  // for progress purposes, but its step failed and finalizeRun needs to know.
  const failedItemCount = state.failedItemCount + (state.lastStepError ? 1 : 0);
  await updateRunProgress(state.worldId, state.ownerId, state.runId, completed, state.total);
  return { completed, failedItemCount, currentItem: undefined, currentItemStepsDone: [] };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const END_KEY = '__end__';

function routeAfterDequeue(state: ForgeState): 'research' | typeof END_KEY {
  return state.signal === 'continue' ? 'research' : END_KEY;
}

function routeAfterResearch(state: ForgeState): 'inception' | typeof END_KEY {
  return state.lastStepError?.fatal ? END_KEY : 'inception';
}

function routeAfterInception(state: ForgeState): 'expansion' | 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
  return 'expansion';
}

function routeAfterExpansion(state: ForgeState): 'branching' | 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
  if (state.commitPolicy !== 'auto_commit' && !requiresUserReview(state)) return 'finishItem';
  return 'branching';
}

function routeAfterBranching(state: ForgeState): 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  return state.lastStepError?.fatal ? END_KEY : 'finishItem';
}

// ---------------------------------------------------------------------------
// Graph — one compiled instance per process, checkpointed on runId as thread_id
// ---------------------------------------------------------------------------

let graphPromise: ReturnType<typeof buildGraph> | null = null;

async function buildGraph() {
  const checkpointer = await getCheckpointer();
  return new StateGraph(ForgeAnnotation)
    .addNode('dequeue', dequeueNode)
    .addNode('research', researchNode)
    .addNode('inception', inceptionNode)
    .addNode('expansion', expansionNode)
    .addNode('branching', branchingNode)
    .addNode('finishItem', finishItemNode)
    .addEdge('__start__', 'dequeue')
    .addConditionalEdges('dequeue', routeAfterDequeue, { research: 'research', [END_KEY]: '__end__' })
    .addConditionalEdges('research', routeAfterResearch, { inception: 'inception', [END_KEY]: '__end__' })
    .addConditionalEdges('inception', routeAfterInception, { expansion: 'expansion', finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addConditionalEdges('expansion', routeAfterExpansion, { branching: 'branching', finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addConditionalEdges('branching', routeAfterBranching, { finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addEdge('finishItem', 'dequeue')
    .compile({ checkpointer });
}

/** Exported for forgeGraph.test.ts only — production code should go through startForgeRun/resumeForgeRun. */
export function getForgeGraph() {
  if (!graphPromise) graphPromise = buildGraph();
  return graphPromise;
}

/** Exported for forgeGraph.test.ts only — production code should go through startForgeRun/resumeForgeRun. */
export { dequeueNode, researchNode, inceptionNode, expansionNode, branchingNode, finishItemNode, routeAfterExpansion };

/**
 * Hard technical ceiling on graph super-steps, independent of the user-facing
 * forgeMaxDepth/forgeMaxChildren soft limits — same PoC-verified pattern used
 * elsewhere this session. 6 super-steps per queue item (dequeue/research/
 * inception/expansion/branching/finishItem); Cartographer caps children at 5
 * per branch.
 */
function computeRecursionLimit(forgeMaxDepth: number, forgeMaxChildren: number): number {
  const branchFactor = forgeMaxChildren > 0 ? forgeMaxChildren : 5;
  let totalItems = 0;
  let levelCount = 1;
  for (let d = 0; d <= forgeMaxDepth; d++) {
    totalItems += levelCount;
    levelCount *= branchFactor;
  }
  return Math.min(20_000, totalItems * 6 + 20);
}

async function finalizeRun(runId: string, worldId: string, ownerId: string, result: ForgeState): Promise<void> {
  switch (result.signal) {
    case 'completed':
      if (result.failedItemCount > 0) {
        // The queue drained without a fatal error, but at least one item's step
        // failed (e.g. a timeout) — surface this as 'failed' rather than a
        // misleading 'completed', matching the failed-step banner the client
        // already derives from run_events.
        await markRunStatus(
          worldId, ownerId, runId, 'failed',
          `${result.failedItemCount} of ${result.total} item${result.total === 1 ? '' : 's'} failed to complete a step. See step history for details.`,
        );
      } else {
        await markRunStatus(worldId, ownerId, runId, 'completed');
      }
      await releaseLocks(worldId, ownerId, runId);
      break;
    case 'paused':
      await markRunStatus(worldId, ownerId, runId, 'paused');
      break;
    case 'needs_input':
      await markRunStatus(worldId, ownerId, runId, 'needs_input');
      break;
    case 'error':
      await markRunStatus(worldId, ownerId, runId, 'failed', result.lastStepError?.message);
      await releaseLocks(worldId, ownerId, runId);
      break;
    case 'stopped':
      // Already set to 'stopped' + unlocked by runsService.cancelRun.
      break;
  }
}

// ---------------------------------------------------------------------------
// Entry points — called from routes/runs.ts, fire-and-forget (same
// no-streaming, poll-instead contract as the rest of this codebase's agent calls)
// ---------------------------------------------------------------------------

export async function startForgeRun(params: {
  runId: string;
  worldId: string;
  ownerId: string;
  articleId: string;
  articleTitle: string;
  startStep: ForgeQueueItem['startStep'];
  contextDepth: ContextDepth;
  branchingMode: 'specific' | 'conceptual';
  forgeMode: 'breadth' | 'depth';
  forgeMaxDepth: number;
  forgeMaxChildren: number;
  forgeUseOracle: boolean;
  forgeUseContinuityEditor: boolean;
  forgeUseGroundingCheck: boolean;
  forgeUseDedupCheck: boolean;
  forgeContinuationMode?: ForgeContinuationMode;
  forgeInceptionExistingMode?: ForgeExistingContentMode;
  forgeExpansionExistingMode?: ForgeExistingContentMode;
  forgeBranchingExistingMode?: ForgeBranchingExistingMode;
  autonomyMode?: AutonomyMode;
  reviewPolicy?: ReviewPolicy;
  commitPolicy?: CommitPolicy;
}): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    await updateRunProgress(params.worldId, params.ownerId, params.runId, 0, 1);
    const graph = await getForgeGraph();
    const config = {
      configurable: { thread_id: params.runId },
      recursionLimit: computeRecursionLimit(params.forgeMaxDepth, params.forgeMaxChildren),
    };
    // Fetched once for the whole run — world-level metadata (name/tone/style)
    // can't change mid-run, so every node reuses this instead of re-fetching.
    const worldContext = await fetchWorldContext(params.worldId);

    try {
      const result = await graph.invoke(
        {
          worldId: params.worldId,
          runId: params.runId,
          ownerId: params.ownerId,
          worldContext,
          ...contractState(expandRunContract({
            rootArticleId: params.articleId,
            maxDepth: params.forgeMaxDepth,
            autonomyMode: params.autonomyMode,
            reviewPolicy: params.reviewPolicy,
            commitPolicy: params.commitPolicy,
          })),
          contextDepth: params.contextDepth,
          branchingMode: params.branchingMode,
          forgeMode: params.forgeMode,
          forgeMaxDepth: params.forgeMaxDepth,
          forgeMaxChildren: params.forgeMaxChildren,
          forgeUseOracle: params.forgeUseOracle,
          forgeUseContinuityEditor: params.forgeUseContinuityEditor,
          forgeUseGroundingCheck: params.forgeUseGroundingCheck,
          forgeUseDedupCheck: params.forgeUseDedupCheck,
          forgeContinuationMode: params.forgeContinuationMode ?? 'recursive',
          forgeInceptionExistingMode: params.forgeInceptionExistingMode ?? 'improve',
          forgeExpansionExistingMode: params.forgeExpansionExistingMode ?? 'improve',
          forgeBranchingExistingMode: params.forgeBranchingExistingMode ?? 'append_deduped',
          queue: [{ articleId: params.articleId, title: params.articleTitle, depth: 0, startStep: params.startStep }],
          total: 1,
        },
        config,
      );
      await finalizeRun(params.runId, params.worldId, params.ownerId, result as ForgeState);
    } catch (err) {
      if (err instanceof GraphRecursionError) {
        await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'Forge run exceeded its recursion limit.');
        await releaseLocks(params.worldId, params.ownerId, params.runId);
        return;
      }
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', errorMessage(err));
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    }
  });
}

export async function resumeForgeRun(params: { runId: string; worldId: string; ownerId: string }): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    const graph = await getForgeGraph();
    const config = { configurable: { thread_id: params.runId } };

    const snapshot = await graph.getState(config);
    const restored = snapshot.values as ForgeState;
    if (!restored?.queue) {
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'No checkpointed state found to resume from.');
      return;
    }
    // Backfills runs checkpointed before worldContext caching existed — a
    // missing value here is otherwise just today's normal cache-miss case.
    if (!restored.worldContext) {
      restored.worldContext = await fetchWorldContext(params.worldId);
    }

    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    const invokeConfig = {
      ...config,
      recursionLimit: computeRecursionLimit(restored.forgeMaxDepth, restored.forgeMaxChildren),
    };

    try {
      const result = await graph.invoke(restored, invokeConfig);
      const finalState = result as ForgeState;
      await finalizeRun(params.runId, params.worldId, params.ownerId, finalState);
    } catch (err) {
      if (err instanceof GraphRecursionError) {
        await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'Forge run exceeded its recursion limit.');
        await releaseLocks(params.worldId, params.ownerId, params.runId);
        return;
      }
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', errorMessage(err));
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    }
  });
}
