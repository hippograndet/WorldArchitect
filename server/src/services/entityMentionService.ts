import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import type { QueryExecutor } from '../db/executor.js';
import { buildContextPackage } from './archivist.js';
import { pointArticleAtVersion, writeArticleVersion } from './articleVersions.js';
import { upsertEntry } from './worldBible.js';
import { reindexArticle } from './searchIndex.js';
import { runSyncRules } from './syncRules.js';
import { MentionExtractorAgent } from '../agents/mentionExtractor.js';

type DbRow = Record<string, unknown>;

export interface EntityMentionRow {
  id: string;
  worldId: string;
  sourceArticleId: string;
  articleId: string | null;
  title: string;
  templateType: string;
  summary: string | null;
  status: 'pending' | 'created' | 'ignored';
  createdAt: number;
}

export class EntityMentionServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export function parseEntityMention(row: DbRow): EntityMentionRow {
  return {
    id: row.id as string,
    worldId: row.world_id as string,
    sourceArticleId: row.source_article_id as string,
    articleId: (row.article_id as string | null) ?? null,
    title: row.title as string,
    templateType: row.template_type as string,
    summary: (row.summary as string | null) ?? null,
    status: row.status as EntityMentionRow['status'],
    createdAt: row.created_at as number,
  };
}

async function getKnownTitles(exec: QueryExecutor, worldId: string, ownerId: string): Promise<string[]> {
  const rows = await exec.all<{ title: string }>(
    'SELECT title FROM articles WHERE world_id = ? AND owner_id = ?',
    [worldId, ownerId],
  );
  return rows.map((row) => row.title);
}

async function scanTargets(input: { worldId: string; ownerId: string; articleId?: string }): Promise<Array<{ id: string; description: string }>> {
  const exec = getDbClient();
  if (input.articleId) {
    const row = await exec.get<{ id: string; description: string | null }>(`
      SELECT a.id, av.description
      FROM articles a
      LEFT JOIN article_versions av ON av.id = a.current_version_id
      WHERE a.id = ? AND a.world_id = ? AND a.owner_id = ?
    `, [input.articleId, input.worldId, input.ownerId]);
    if (!row) throw new EntityMentionServiceError('Article not found', 404, 'ARTICLE_NOT_FOUND');
    return row.description?.trim() ? [{ id: row.id, description: row.description }] : [];
  }

  return getDbClient().all<{ id: string; description: string }>(`
    SELECT a.id, av.description
    FROM articles a
    JOIN article_versions av ON av.id = a.current_version_id
    WHERE a.world_id = ? AND a.owner_id = ?
      AND TRIM(COALESCE(av.description, '')) != ''
    ORDER BY a.updated_at DESC
    LIMIT 25
  `, [input.worldId, input.ownerId]);
}

export async function scanEntityMentions(input: {
  worldId: string;
  ownerId: string;
  articleId?: string;
  pipelineRunId?: string;
}): Promise<{ scannedArticles: number; created: number; mentions: EntityMentionRow[] }> {
  const exec = getDbClient();
  const targets = await scanTargets(input);
  const knownTitles = await getKnownTitles(exec, input.worldId, input.ownerId);
  const agent = new MentionExtractorAgent();
  const now = Date.now();
  const created: EntityMentionRow[] = [];

  for (const target of targets) {
    const contextPackage = await buildContextPackage(input.worldId, target.id, {
      mode: 'default',
      contextDepth: 'mid',
      ownerId: input.ownerId,
    });
    const result = await agent.run(input.worldId, {
      contextPackage,
      description: target.description,
      knownTitles,
    }, {
      pipelineRunId: input.pipelineRunId,
      pipelineType: 'concept_scan',
      articleId: target.id,
      ownerId: input.ownerId,
    });

    for (const mention of result.output.mentions) {
      const title = mention.title.trim();
      if (!title) continue;

      const existingMention = await exec.get<{ id: string }>(`
        SELECT id FROM entity_mentions
        WHERE world_id = ? AND owner_id = ? AND source_article_id = ? AND title = ?
          AND status IN ('pending', 'created')
        LIMIT 1
      `, [input.worldId, input.ownerId, target.id, title]);
      if (existingMention) continue;

      const existingArticle = await exec.get<{ id: string }>(
        'SELECT id FROM articles WHERE world_id = ? AND owner_id = ? AND title = ? LIMIT 1',
        [input.worldId, input.ownerId, title],
      );

      const id = nanoid();
      await exec.run(`
        INSERT INTO entity_mentions
          (id, world_id, owner_id, source_article_id, article_id, title, template_type, summary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `, [
        id,
        input.worldId,
        input.ownerId,
        target.id,
        existingArticle?.id ?? null,
        title,
        mention.templateType ?? 'general',
        mention.summary ?? null,
        now,
      ]);
      const row = await exec.get<DbRow>('SELECT * FROM entity_mentions WHERE id = ? AND owner_id = ?', [id, input.ownerId]);
      if (row) created.push(parseEntityMention(row));
    }
  }

  return { scannedArticles: targets.length, created: created.length, mentions: created };
}

export async function acceptEntityMention(input: {
  worldId: string;
  ownerId: string;
  mentionId: string;
}): Promise<EntityMentionRow> {
  const exec = getDbClient();
  const mention = await exec.get<DbRow>(
    'SELECT * FROM entity_mentions WHERE id = ? AND world_id = ? AND owner_id = ?',
    [input.mentionId, input.worldId, input.ownerId],
  );
  if (!mention) throw new EntityMentionServiceError('Entity mention not found', 404, 'MENTION_NOT_FOUND');
  if (mention.status === 'ignored') throw new EntityMentionServiceError('Ignored mentions cannot be accepted.', 400, 'MENTION_IGNORED');

  const now = Date.now();
  let targetArticleId = (mention.article_id as string | null) ?? null;

  await exec.transaction(async (tx) => {
    const source = await tx.get<{ id: string; depth: number }>(
      'SELECT id, depth FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?',
      [mention.source_article_id as string, input.worldId, input.ownerId],
    );
    if (!source) throw new EntityMentionServiceError('Source article not found', 404, 'SOURCE_ARTICLE_NOT_FOUND');

    const existing = await tx.get<{ id: string }>(
      'SELECT id FROM articles WHERE world_id = ? AND owner_id = ? AND title = ? LIMIT 1',
      [input.worldId, input.ownerId, mention.title as string],
    );

    targetArticleId = existing?.id ?? targetArticleId;
    if (!targetArticleId) {
      targetArticleId = nanoid();
      const versionId = nanoid();
      await tx.run(`
        INSERT INTO articles (id, world_id, owner_id, title, template_type, status, depth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'stub', ?, ?, ?)
      `, [
        targetArticleId,
        input.worldId,
        input.ownerId,
        mention.title,
        mention.template_type ?? 'general',
        source.depth ?? 1,
        now,
        now,
      ]);
      await writeArticleVersion(tx, {
        articleId: targetArticleId,
        ownerId: input.ownerId,
        versionId,
        versionNumber: 1,
        introduction: (mention.summary as string | null) ?? '',
        description: '',
        chronology: '',
        now,
      });
      await pointArticleAtVersion(tx, targetArticleId, versionId, now);
      if (mention.summary) {
        await upsertEntry(tx, input.worldId, targetArticleId, mention.summary as string);
      }
    }

    await tx.run(`
      INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
      VALUES (?, ?, ?, 'references')
      ON CONFLICT (source_article_id, target_article_id) DO NOTHING
    `, [mention.source_article_id as string, targetArticleId, input.ownerId]);

    await tx.run(
      `UPDATE entity_mentions SET article_id = ?, status = 'created' WHERE id = ? AND owner_id = ?`,
      [targetArticleId, input.mentionId, input.ownerId],
    );
  });

  await runSyncRules(input.worldId, mention.source_article_id as string);
  if (targetArticleId) await reindexArticle(input.worldId, targetArticleId, input.ownerId);

  const updated = await exec.get<DbRow>('SELECT * FROM entity_mentions WHERE id = ? AND owner_id = ?', [input.mentionId, input.ownerId]);
  return parseEntityMention(updated!);
}
