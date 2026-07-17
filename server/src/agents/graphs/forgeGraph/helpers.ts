import { nanoid } from 'nanoid';
import { getDbClient } from '../../../db/client.js';
import { buildContextPackage } from '../../../services/archivist.js';
import { savePendingDraft } from '../../../services/draftsService.js';
import { getLatestReviewDecision } from '../../../services/runReviewItems.js';
import type { ForgeState } from '../forgeState.js';
import type { ContextPackage } from '../../../services/archivist.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Same fatal-vs-recoverable classification forgeSlice.ts already used client-side. */
export function isFatal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|429|authentication|unauthorized|quota/i.test(msg);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * "Existing content" for Inception's improve/create/skip decision. Under a
 * published-basis run, this means the published version specifically (empty
 * if the article was never published) — the same treatment applied to every
 * other article pulled into this run's context (see archivist.ts) applied
 * here to the article actually being edited, not just its neighbors.
 */
export async function getCurrentIntro(ownerId: string, articleId: string, contextBasis?: ForgeState['contextBasis']): Promise<string> {
  const versionColumn = contextBasis === 'published' ? 'a.published_version_id' : 'a.current_version_id';
  const row = await getDbClient().get<{ introduction: string }>(
    `SELECT av.introduction
     FROM articles a
     LEFT JOIN article_versions av ON av.id = ${versionColumn}
     WHERE a.id = ? AND a.owner_id = ?`,
    [articleId, ownerId],
  );
  return row?.introduction ?? '';
}

export async function getCurrentDescription(ownerId: string, articleId: string, contextBasis?: ForgeState['contextBasis']): Promise<string> {
  const versionColumn = contextBasis === 'published' ? 'a.published_version_id' : 'a.current_version_id';
  const row = await getDbClient().get<{ description: string }>(
    `SELECT av.description
     FROM articles a
     LEFT JOIN article_versions av ON av.id = ${versionColumn}
     WHERE a.id = ? AND a.owner_id = ?`,
    [articleId, ownerId],
  );
  return row?.description ?? '';
}

export async function getChildCount(ownerId: string, articleId: string): Promise<number> {
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
 * runInceptionGraph in this same invocation), its targetIntroduction is stale
 * — built before Herald wrote the intro — and must be patched with the
 * one that was just saved. Otherwise, fall back to researchNode's package
 * (state.currentItemContextPackage, built once before Inception ran) patched
 * the same way — this is the common skip-existing/resumed-review case, and
 * reusing it here is what keeps the whole Research→Inception→Expansion
 * cascade down to exactly one buildContextPackage call. Only when neither is
 * available (e.g. a pre-Research checkpoint being resumed) does this build
 * fresh from the DB.
 */
export async function resolveItemContextPackage(
  state: ForgeState,
  articleId: string,
  introduction: string,
  prebuilt?: ContextPackage,
): Promise<ContextPackage> {
  const base = prebuilt ?? state.currentItemContextPackage;
  if (base) return { ...base, targetIntroduction: introduction };
  return buildContextPackage(state.worldId, articleId, {
    mode: 'default',
    contextDepth: state.contextDepth,
    contextBasis: state.contextBasis,
    ownerId: state.ownerId,
  });
}

export async function logEvent(state: Pick<ForgeState, 'runId' | 'worldId' | 'ownerId'>, step: string, title: string, ok: boolean, message?: string): Promise<void> {
  await getDbClient().run(
    `INSERT INTO run_events (id, run_id, step, title, ok, message, created_at)
     SELECT ?, r.id, ?, ?, ?, ?, ?
       FROM runs r
      WHERE r.id = ? AND r.world_id = ? AND r.owner_id = ?`,
    [nanoid(), step, title, ok ? 1 : 0, message ?? null, Date.now(), state.runId, state.worldId, state.ownerId],
  );
}

export function requiresUserReview(state: ForgeState): boolean {
  return state.reviewPolicy === 'user_must_accept' || state.reviewPolicy === 'user_must_select' || state.autonomyMode === 'manual' || state.autonomyMode === 'review_each_step';
}

export function stringDecision(review: Awaited<ReturnType<typeof getLatestReviewDecision>>, key: string, fallback: string): string {
  const value = review?.decision?.[key];
  return typeof value === 'string' ? value : fallback;
}

export function stringPayload(review: Awaited<ReturnType<typeof getLatestReviewDecision>>, key: string, fallback: string): string {
  const value = review?.payload?.[key];
  return typeof value === 'string' ? value : fallback;
}

export function selectedChildrenDecision(
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

export function payloadChildren(
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

export function payloadIdeas(review: Awaited<ReturnType<typeof getLatestReviewDecision>>): Array<{ id: string; theme: string; detail: string }> {
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

export function selectedIdeasDecision(
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
export async function persistExpandDraft(params: {
  worldId: string;
  articleId: string;
  ownerId: string;
  description: string;
  /**
   * A staged Inception introduction not yet committed anywhere durable
   * (see ForgeState.inceptionIntroChanged). Carrying it into the draft's own
   * content means a later manual accept of this pending draft — whether from
   * this run resuming or from the article page, outside any Forge run —
   * still lands both pieces in one version, instead of the intro going stale
   * or needing its own separate commit.
   */
  introduction?: string;
  runId?: string;
  contextBasis?: ForgeState['contextBasis'];
  contextDraftIds?: string[];
}): Promise<void> {
  await savePendingDraft({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineType: 'expand_description',
    phase: 'done',
    draftContent: {
      description: params.description,
      ...(params.introduction !== undefined ? { introduction: params.introduction } : {}),
    },
    sourceRunId: params.runId,
    contextBasis: params.contextBasis,
    contextDraftIds: params.contextDraftIds,
    displayTitle: 'Recursive Expand draft',
  });
}
