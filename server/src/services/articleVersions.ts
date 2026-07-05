import { nanoid } from 'nanoid';
import type { QueryExecutor } from '../db/executor.js';
import { countWords, getNextVersionNumber } from './articlesMapper.js';

export interface WriteArticleVersionInput {
  articleId: string;
  ownerId: string;
  introduction?: string | null;
  description?: string | null;
  chronology?: string | null;
  versionId?: string;
  versionNumber?: number;
  now?: number;
  wordCount?: number;
  expansionParams?: unknown;
  proposalUsed?: unknown;
  isRevert?: boolean;
  revertedFromVersionId?: string | null;
}

export interface WriteArticleVersionResult {
  versionId: string;
  versionNumber: number;
  now: number;
}

export async function writeArticleVersion(
  exec: QueryExecutor,
  input: WriteArticleVersionInput,
): Promise<WriteArticleVersionResult> {
  const introduction = input.introduction ?? '';
  const description = input.description ?? '';
  const chronology = input.chronology ?? '';
  const versionId = input.versionId ?? nanoid();
  const versionNumber = input.versionNumber ?? await getNextVersionNumber(exec, input.articleId);
  const now = input.now ?? Date.now();
  const wordCount = input.wordCount ?? countWords(`${introduction} ${description} ${chronology}`);

  await exec.run(`
    INSERT INTO article_versions
      (id, article_id, owner_id, version_number, introduction, description, chronology,
       expansion_params, proposal_used, word_count, is_revert, reverted_from_version_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    versionId,
    input.articleId,
    input.ownerId,
    versionNumber,
    introduction,
    description,
    chronology,
    input.expansionParams ?? null,
    input.proposalUsed ?? null,
    wordCount,
    input.isRevert ? 1 : 0,
    input.revertedFromVersionId ?? null,
    now,
  ]);

  return { versionId, versionNumber, now };
}

export async function pointArticleAtVersion(
  exec: QueryExecutor,
  articleId: string,
  versionId: string,
  now: number,
): Promise<void> {
  await exec.run('UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?', [versionId, now, articleId]);
}

export async function writeArticleVersionAndSetCurrent(
  exec: QueryExecutor,
  input: WriteArticleVersionInput,
): Promise<WriteArticleVersionResult> {
  const result = await writeArticleVersion(exec, input);
  await pointArticleAtVersion(exec, input.articleId, result.versionId, result.now);
  return result;
}
