import { getDbClient } from '../../db/client.js';
import { recordArticleIssues, recordProposedLinks, recordWorldIssues } from '../../services/issueRecorder.js';
import { addRunEvent, bumpRunBudget, markRunStatus, releaseLocks, updateRunProgress } from '../../services/runsService.js';
import { savePendingDraft } from '../../services/draftsService.js';
import { scanEntityMentions } from '../../services/entityMentionService.js';
import { runWithUserContext } from '../../requestContext.js';
import { runReorganizeGraph } from './pipelines/reorganize.js';
import { runCohereGraph } from './pipelines/cohere.js';
import { runAuditGraph } from './pipelines/audit.js';
import type { ContextDepth } from '../../services/archivist.js';
import type { DraftContextBasis } from '../../services/draftsService.js';

export type ConsolidatePipelineType = 'reorganize' | 'cohere' | 'audit' | 'concept_scan';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function startConsolidateRun(params: {
  runId: string;
  worldId: string;
  ownerId: string;
  pipelineType: ConsolidatePipelineType;
  articleId?: string;
  articleTitle?: string;
  contextDepth: ContextDepth;
  contextBasis: DraftContextBasis;
  sampleSize?: number;
  focus?: 'all' | 'recent';
}): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    const title = params.articleTitle ?? 'World';
    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    await updateRunProgress(params.worldId, params.ownerId, params.runId, 0, 1);

    try {
      if (params.pipelineType === 'reorganize') {
        if (!params.articleId) throw new Error('Reorganize requires an article target.');
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Reorganize', title, true, 'Reorganize started.');
        const result = await runReorganizeGraph({
          worldId: params.worldId,
          ownerId: params.ownerId,
          articleId: params.articleId,
          contextDepth: params.contextDepth,
          contextBasis: params.contextBasis,
          pipelineRunId: params.runId,
        });
        await bumpRunBudget(params.worldId, params.ownerId, params.runId, result.tokensIn + result.tokensOut);
        await savePendingDraft({
          worldId: params.worldId,
          ownerId: params.ownerId,
          articleId: params.articleId,
          pipelineType: 'reorganize',
          phase: 'done',
          draftContent: { description: result.description, introduction: result.introduction, retentionIssues: result.retentionIssues },
          sourceRunId: params.runId,
          runType: 'reorganize',
          contextBasis: params.contextBasis,
          contextDraftIds: result.contextDraftIds,
          displayTitle: 'Consolidation draft',
        });
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Draft', title, true, 'Draft saved to Inbox.');
      }

      if (params.pipelineType === 'cohere') {
        if (!params.articleId) throw new Error('Coherence check requires an article target.');
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Coherence', title, true, 'Coherence check started.');
        // Capture the version being reviewed before the (LLM-backed, possibly
        // slow) check runs, not after, so a concurrent edit mid-check can't
        // get incorrectly stamped as "reviewed" once the check completes.
        const reviewedArticle = params.contextBasis === 'current'
          ? await getDbClient().get<{ current_version_id: string | null }>(
              `SELECT current_version_id FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?`,
              [params.articleId, params.worldId, params.ownerId],
            )
          : null;
        const result = await runCohereGraph({
          worldId: params.worldId,
          ownerId: params.ownerId,
          articleId: params.articleId,
          contextDepth: params.contextDepth,
          contextBasis: params.contextBasis,
          pipelineRunId: params.runId,
        });
        await bumpRunBudget(params.worldId, params.ownerId, params.runId, result.tokensIn + result.tokensOut);
        await recordArticleIssues(getDbClient(), {
          worldId: params.worldId,
          ownerId: params.ownerId,
          articleId: params.articleId,
          source: 'warden',
          issues: result.warnings.map((warning) => ({
            severity: warning.severity === 'conflict' ? 'blocking' : 'warning',
            code: 'COHERENCE_WARNING',
            explanation: warning.description,
          })),
        });
        if (reviewedArticle?.current_version_id) {
          await getDbClient().run(
            `UPDATE articles SET last_consolidated_version_id = ? WHERE id = ? AND owner_id = ?`,
            [reviewedArticle.current_version_id, params.articleId, params.ownerId],
          );
        }
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Flags', title, true, `${result.warnings.length} flag${result.warnings.length === 1 ? '' : 's'} sent to Inbox.`);
      }

      if (params.pipelineType === 'audit') {
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Audit', title, true, 'World audit started.');
        const result = await runAuditGraph({
          worldId: params.worldId,
          ownerId: params.ownerId,
          sampleSize: params.sampleSize,
          focus: params.focus,
          pipelineRunId: params.runId,
        });
        await bumpRunBudget(params.worldId, params.ownerId, params.runId, result.tokensIn + result.tokensOut);
        await recordProposedLinks(getDbClient(), { worldId: params.worldId, ownerId: params.ownerId, proposals: result.edgeProposals });
        await recordWorldIssues(getDbClient(), { worldId: params.worldId, ownerId: params.ownerId, source: 'auditor', warnings: result.globalWarnings });
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Suggestions', title, true, `${result.edgeProposals.length} link proposal${result.edgeProposals.length === 1 ? '' : 's'} and ${result.globalWarnings.length} flag${result.globalWarnings.length === 1 ? '' : 's'} sent to Inbox.`);
      }

      if (params.pipelineType === 'concept_scan') {
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Concepts', title, true, 'Concept scan started.');
        const result = await scanEntityMentions({
          worldId: params.worldId,
          ownerId: params.ownerId,
          articleId: params.articleId,
          pipelineRunId: params.runId,
        });
        await addRunEvent(params.worldId, params.ownerId, params.runId, 'Concepts', title, true, `${result.created} candidate${result.created === 1 ? '' : 's'} sent to Inbox.`);
      }

      await updateRunProgress(params.worldId, params.ownerId, params.runId, 1, 1);
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'completed');
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    } catch (err) {
      const message = errorMessage(err);
      await addRunEvent(params.worldId, params.ownerId, params.runId, 'Error', title, false, message);
      await updateRunProgress(params.worldId, params.ownerId, params.runId, 0, 1, 1);
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', message);
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    }
  });
}
