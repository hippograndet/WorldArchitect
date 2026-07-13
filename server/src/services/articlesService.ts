import { nanoid } from 'nanoid';
import type { QueryExecutor } from '../db/executor.js';
import { getDbClient } from '../db/client.js';
import { upsertEntry, getEntrySummary } from './worldBible.js';
import { runSyncRules } from './syncRules.js';
import { reindexArticle } from './searchIndex.js';
import { GeneratedDraftContentSchema } from './articlesSchemas.js';
import { writeArticleVersion, writeArticleVersionAndSetCurrent } from './articleVersions.js';
import { markDraftAccepted } from './draftsService.js';
import {
  bodyToDescription,
  countWords,
  getNextVersionNumber,
  parseArticle,
  parseVersion,
  requireArticleForTenant,
  type ArticleContent,
  type DbRow,
} from './articlesMapper.js';

export class ArticleServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Agents/manual edits should not silently overwrite user-confirmed or published
 * facts — they should require an explicit override instead. Published content
 * is the only status this guards; draft/reviewed/stub can always be overwritten.
 */
function assertNotOverwritingPublished(article: DbRow, force: boolean | undefined): void {
  if (force) return;
  if ((article.status as string) === 'published') {
    throw new ArticleServiceError(
      'This article is published. Accepting or saving this change would silently overwrite published content — pass force=true to override.',
      409,
      'PUBLISHED_CONTENT_OVERWRITE',
    );
  }
}

/**
 * Defense-in-depth alongside assertNotOverwritingPublished, same call sites:
 * routes/agents.ts's assertArticleUnlocked is the fail-fast layer before an
 * LLM call is spent, but this is the actual write chokepoint — it also
 * catches a stray manual edit racing an active Spark run. `activeRunId` lets
 * a run's own write path (once write-mode graph nodes exist) pass through
 * its own lock; manual routes never supply one, so any lock blocks them.
 */
function assertNotLocked(article: DbRow, activeRunId: string | undefined): void {
  const lockedBy = article.locked_by_run_id as string | null;
  if (lockedBy && lockedBy !== activeRunId) {
    throw new ArticleServiceError(
      'This article is locked by an in-progress run.',
      409,
      'ARTICLE_LOCKED',
    );
  }
}

export interface AcceptDraftInput {
  worldId: string;
  articleId: string;
  ownerId: string;
  draftId?: string;
  descriptionOverride?: string;
  introductionOverride?: string;
  force?: boolean;
  activeRunId?: string;
}

export interface CreateArticleInput {
  worldId: string;
  ownerId: string;
  categoryId: string;
  title: string;
  templateType: string;
  introduction: string;
  description?: string;
  body?: string;
  isFixedPoint: boolean;
}

export interface UpdateArticleInput {
  worldId: string;
  articleId: string;
  ownerId: string;
  body?: string;
  introduction?: string;
  description?: string;
  status?: 'stub' | 'draft' | 'reviewed';
  title?: string;
  isFixedPoint?: boolean;
  force?: boolean;
  activeRunId?: string;
}

export interface RevertArticleInput {
  worldId: string;
  articleId: string;
  versionId: string;
  ownerId: string;
}

export interface BatchCreateChildArticlesInput {
  worldId: string;
  ownerId: string;
  parentArticleId: string;
  children: Array<{
    title: string;
    introduction: string;
    templateType: string;
  }>;
}

export interface CommitArticleContentInput {
  worldId: string;
  articleId: string;
  ownerId: string;
  introduction: string;
  description: string;
  /** Omit to leave articles.status untouched (e.g. a pure revert). */
  status?: 'stub' | 'draft' | 'reviewed';
  versionId?: string;
  isRevert?: boolean;
  revertedFromVersionId?: string | null;
  expansionParams?: unknown;
  proposalUsed?: unknown;
  wordCount?: number;
  /**
   * Whether to sync world_bible_entries with `introduction`. Defaults to true.
   * Set false when a commit doesn't actually change the introduction (e.g. a
   * description-only append) — upsertEntry re-renders the whole world Bible
   * to refresh its token count, which is wasteful to trigger for no reason.
   */
  syncBibleIntroduction?: boolean;
}

/**
 * The single chokepoint for "commit new content onto an existing article":
 * write a new article_versions row, point articles.current_version_id at it,
 * optionally update status, and keep world_bible_entries in sync — the three
 * things updateArticle/acceptDraft/revertArticleVersion used to each do by
 * hand, in slightly different shapes. Row *creation* (createArticle,
 * batchCreateChildArticles, create_child's new article) stays outside this —
 * there's no existing current_version_id to move there.
 */
async function commitArticleContent(
  exec: QueryExecutor,
  input: CommitArticleContentInput,
): Promise<ArticleContent & { versionId: string }> {
  const versionNumber = await getNextVersionNumber(exec, input.articleId);
  const { versionId } = await writeArticleVersionAndSetCurrent(exec, {
    articleId: input.articleId,
    ownerId: input.ownerId,
    versionId: input.versionId,
    versionNumber,
    introduction: input.introduction,
    description: input.description,
    isRevert: input.isRevert,
    revertedFromVersionId: input.revertedFromVersionId,
    expansionParams: input.expansionParams,
    proposalUsed: input.proposalUsed,
    wordCount: input.wordCount,
  });

  if (input.status !== undefined) {
    await exec.run('UPDATE articles SET status = ? WHERE id = ? AND owner_id = ?', [input.status, input.articleId, input.ownerId]);
  }

  if (input.syncBibleIntroduction ?? true) {
    await upsertEntry(exec, input.worldId, input.articleId, input.introduction);
  }

  return {
    versionId,
    introduction: input.introduction,
    description: input.description,
    wordCount: input.wordCount ?? countWords(`${input.introduction} ${input.description}`),
  };
}

/**
 * The matching read side: "current content" today is article_versions for
 * description, but world_bible_entries for introduction (see commitArticleContent
 * doc and dev-docs/engineering/practices.md) — this centralizes that merge
 * instead of leaving it inline in routes/articles.ts. Same semantics as
 * before: introduction prefers the Bible entry, falling back to the version's
 * own snapshot only if no Bible row exists yet.
 */
export async function getCurrentArticleContent(
  exec: QueryExecutor,
  input: { worldId: string; articleId: string; ownerId: string; currentVersionId: string | null },
): Promise<ArticleContent> {
  const version = input.currentVersionId
    ? await exec.get<DbRow>(
        'SELECT introduction, description, word_count FROM article_versions WHERE id = ?',
        [input.currentVersionId],
      )
    : undefined;
  const bibleEntry = await exec.get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE article_id = ? AND owner_id = ?',
    [input.articleId, input.ownerId],
  );

  return {
    introduction: bibleEntry?.summary ?? (version?.introduction as string | undefined) ?? '',
    description: (version?.description as string) ?? '',
    wordCount: (version?.word_count as number) ?? 0,
  };
}

export async function createArticle(input: CreateArticleInput) {
  const exec = getDbClient();

  const worldExists = await exec.get('SELECT id FROM worlds WHERE id = ? AND owner_id = ?', [input.worldId, input.ownerId]);
  if (!worldExists) throw new ArticleServiceError('World not found', 404);

  const categoryExists = await exec.get(
    'SELECT id FROM categories WHERE id = ? AND world_id = ? AND owner_id = ?',
    [input.categoryId, input.worldId, input.ownerId],
  );
  if (!categoryExists) throw new ArticleServiceError('Category not found', 404);

  const now = Date.now();
  const articleId = nanoid();
  const versionId = nanoid();
  const description = bodyToDescription(input.body, input.description) ?? '';
  const hasContent = description.trim() || input.introduction.trim();
  const status = hasContent ? 'draft' : 'stub';

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO articles
        (id, world_id, owner_id, category_id, title, status, template_type,
         is_fixed_point, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      articleId,
      input.worldId,
      input.ownerId,
      input.categoryId,
      input.title,
      status,
      input.templateType,
      input.isFixedPoint ? 1 : 0,
      versionId,
      now,
      now,
    ]);

    await writeArticleVersion(tx, {
      articleId,
      ownerId: input.ownerId,
      versionId,
      versionNumber: 1,
      introduction: input.introduction,
      description,
      now,
    });

    if (input.introduction.trim()) {
      await upsertEntry(tx, input.worldId, articleId, input.introduction);
    }
  });

  await reindexArticle(input.worldId, articleId);

  const article = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND owner_id = ?', [articleId, input.ownerId]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ? AND owner_id = ?', [versionId, input.ownerId]);

  return { article: parseArticle(article!), version: parseVersion(version!) };
}

export async function updateArticle(input: UpdateArticleInput) {
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, input, input.articleId);
  if (!article) throw new ArticleServiceError('Article not found', 404);
  assertNotOverwritingPublished(article, input.force);
  assertNotLocked(article, input.activeRunId);

  if (
    input.body === undefined &&
    input.description === undefined &&
    input.introduction === undefined &&
    input.title === undefined &&
    input.isFixedPoint === undefined
  ) {
    throw new ArticleServiceError('No editable article fields provided', 400);
  }

  const current = article.current_version_id
    ? await exec.get<{ description: string }>(
        'SELECT description FROM article_versions WHERE id = ? AND owner_id = ?',
        [article.current_version_id, input.ownerId],
      )
    : undefined;

  const description = bodyToDescription(input.body, input.description);
  // Sourced from the World Bible entry, not article_versions.introduction:
  // Inception's accept path (forgeGraph/nodes.ts) still writes only there,
  // never through commitArticleContent, so the version-table copy can go
  // stale as soon as Inception accepts a new introduction. Once this edit
  // does supply its own introduction, commitArticleContent (below) syncs the
  // Bible entry to match, closing the loop for this write.
  const newIntroduction = input.introduction ?? await getEntrySummary(exec, input.worldId, input.articleId);
  const newDescription = description ?? current?.description ?? '';
  const hasContent = newDescription.trim() || newIntroduction.trim();
  const effectiveStatus = input.status ?? (hasContent ? 'draft' : 'stub');

  let versionId = '';
  await exec.transaction(async (tx) => {
    const result = await commitArticleContent(tx, {
      worldId: input.worldId,
      articleId: input.articleId,
      ownerId: input.ownerId,
      introduction: newIntroduction,
      description: newDescription,
      status: effectiveStatus,
      syncBibleIntroduction: input.introduction !== undefined,
    });
    versionId = result.versionId;

    const articleFields: string[] = [];
    const articleValues: unknown[] = [];
    if (input.title !== undefined) {
      articleFields.push('title = ?');
      articleValues.push(input.title);
    }
    if (input.isFixedPoint !== undefined) {
      articleFields.push('is_fixed_point = ?');
      articleValues.push(input.isFixedPoint ? 1 : 0);
    }
    if (articleFields.length > 0) {
      articleValues.push(input.articleId, input.ownerId);
      await tx.run(`UPDATE articles SET ${articleFields.join(', ')} WHERE id = ? AND owner_id = ?`, articleValues);
    }
  });

  await runSyncRules(input.worldId, input.articleId);
  await reindexArticle(input.worldId, input.articleId);

  const updated = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND owner_id = ?', [input.articleId, input.ownerId]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ? AND owner_id = ?', [versionId, input.ownerId]);

  return { article: parseArticle(updated!), version: parseVersion(version!) };
}

export async function revertArticleVersion(input: RevertArticleInput) {
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, input, input.articleId);
  if (!article) throw new ArticleServiceError('Article not found', 404);

  const target = await exec.get<DbRow>(
    'SELECT * FROM article_versions WHERE id = ? AND article_id = ? AND owner_id = ?',
    [input.versionId, input.articleId, input.ownerId],
  );
  if (!target) throw new ArticleServiceError('Version not found', 404);

  let newVersionId = '';
  await exec.transaction(async (tx) => {
    // syncBibleIntroduction (default true) keeps the World Bible entry (the
    // article page's displayed introduction) in sync with whatever version
    // just became current — otherwise a revert would restore the old
    // introduction into article_versions while the Bible entry kept showing
    // whatever was there before the revert.
    const result = await commitArticleContent(tx, {
      worldId: input.worldId,
      articleId: input.articleId,
      ownerId: input.ownerId,
      introduction: target.introduction as string,
      description: target.description as string,
      wordCount: target.word_count as number,
      isRevert: true,
      revertedFromVersionId: input.versionId,
    });
    newVersionId = result.versionId;
  });

  await reindexArticle(input.worldId, input.articleId);

  const newVersion = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ? AND owner_id = ?', [newVersionId, input.ownerId]);
  return parseVersion(newVersion!);
}

export async function batchCreateChildArticles(input: BatchCreateChildArticlesInput) {
  const exec = getDbClient();
  const parent = await exec.get<DbRow>(
    'SELECT id, depth FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?',
    [input.parentArticleId, input.worldId, input.ownerId],
  );
  if (!parent) throw new ArticleServiceError('Parent article not found', 404);

  const now = Date.now();
  const parentDepth = (parent.depth as number) ?? 1;
  const created: Array<{ id: string; title: string }> = [];

  await exec.transaction(async (tx) => {
    for (const child of input.children) {
      const articleId = nanoid();
      const versionId = nanoid();

      await tx.run(`
        INSERT INTO articles
          (id, world_id, owner_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'stub', ?, ?, ?, ?, ?)
      `, [
        articleId,
        input.worldId,
        input.ownerId,
        child.title,
        child.templateType,
        parentDepth + 1,
        versionId,
        now,
        now,
      ]);

      await writeArticleVersion(tx, {
        articleId,
        ownerId: input.ownerId,
        versionId,
        versionNumber: 1,
        introduction: child.introduction,
        description: '',
        wordCount: 0,
        now,
      });

      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [input.parentArticleId, articleId, input.ownerId]);

      await upsertEntry(tx, input.worldId, articleId, child.introduction);

      created.push({ id: articleId, title: child.title });
    }
  });

  for (const child of created) {
    await reindexArticle(input.worldId, child.id);
  }

  return { created };
}

export async function acceptDraft(input: AcceptDraftInput) {
  const { worldId, articleId, ownerId } = input;
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, input, articleId);
  if (!article) throw new ArticleServiceError('Article not found', 404);
  assertNotOverwritingPublished(article, input.force);
  assertNotLocked(article, input.activeRunId);

  const draft = input.draftId
    ? await exec.get<DbRow>(
      `SELECT * FROM pending_drafts
       WHERE id = ? AND article_id = ? AND owner_id = ? AND status = 'pending'`,
      [input.draftId, articleId, ownerId],
    )
    : await exec.get<DbRow>(
      `SELECT * FROM pending_drafts
       WHERE article_id = ? AND owner_id = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [articleId, ownerId],
    );
  if (!draft) {
    throw new ArticleServiceError(
      input.draftId ? 'Draft not found' : 'No pending draft to accept',
      input.draftId ? 404 : 400,
      input.draftId ? 'NOT_FOUND' : undefined,
    );
  }
  const draftId = draft.id as string;

  const draftContentParse = draft.draft_content
    ? GeneratedDraftContentSchema.safeParse(JSON.parse(draft.draft_content as string))
    : null;

  if (draftContentParse && !draftContentParse.success) {
    throw new ArticleServiceError(
      'Generated draft failed validation and was not accepted.',
      400,
      'GENERATED_DRAFT_INVALID',
      draftContentParse.error.flatten().fieldErrors,
    );
  }

  const draftContent = draftContentParse?.data ?? null;
  if (!draftContent) throw new ArticleServiceError('Draft has no content yet (Phase 2 not run)', 400);

  const pipelineType = (draft.pipeline_type as string) ?? 'expand_description';
  const coherenceWarnings = draftContent.coherenceWarnings ?? [];
  const suggestedLinks = draftContent.suggestedLinks ?? [];

  const now = Date.now();
  let versionId = '';
  // Every article whose title/description changes in this call — the main
  // article and a create_child's new child — is reindexed once after commit.
  const touchedArticleIds = new Set<string>([articleId]);

  const currentVersion = article.current_version_id
    ? await exec.get<{ description: string }>(
        'SELECT description FROM article_versions WHERE id = ? AND owner_id = ?',
        [article.current_version_id, ownerId],
      )
    : undefined;
  const currentDescription = currentVersion?.description ?? '';
  // Sourced from the World Bible entry, not article_versions.introduction:
  // Inception's accept path (forgeGraph/nodes.ts) only writes the introduction
  // there, never to article_versions, so the version-table copy goes stale as
  // soon as Inception accepts a new introduction. Reading the Bible entry here
  // is what keeps a later Expansion-draft accept from carrying forward and
  // re-committing that stale value (which would also silently revert the
  // Bible entry back to it via the upsertEntry call below).
  const currentIntroduction = await getEntrySummary(exec, worldId, articleId);

  let newDescription: string;
  let newIntroduction: string;
  let childArticleId: string | null = null;

  if (pipelineType === 'create_child') {
    newDescription = '';
    newIntroduction = input.introductionOverride ?? draftContent.introduction ?? draftContent.childDescription ?? '';
  } else {
    newDescription = input.descriptionOverride ?? draftContent.description ?? '';
    newIntroduction = input.introductionOverride ?? draftContent.introduction ?? currentIntroduction;
  }

  await exec.transaction(async (tx) => {
    if (pipelineType === 'create_child') {
      const parentUpdate = draft.parent_update
        ? (JSON.parse(draft.parent_update as string) as { articleId: string; appendText: string })
        : null;

      const parentDepth = (article.depth as number) ?? 1;
      const childId = nanoid();
      const childVersionId = nanoid();

      await tx.run(`
        INSERT INTO articles
          (id, world_id, owner_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        SELECT ?, world_id, owner_id, title, 'draft', template_type,
               ?, ?, ?, ?
        FROM articles WHERE id = ? AND owner_id = ?
      `, [childId, parentDepth + 1, childVersionId, now, now, articleId, ownerId]);

      await writeArticleVersion(tx, {
        articleId: childId,
        ownerId,
        versionId: childVersionId,
        versionNumber: 1,
        introduction: newIntroduction,
        description: newDescription,
        now,
      });

      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [articleId, childId, ownerId]);

      if (newIntroduction) {
        await upsertEntry(tx, worldId, childId, newIntroduction);
      }

      if (parentUpdate?.appendText) {
        const appendedDesc = currentDescription
          ? `${currentDescription}\n\n${parentUpdate.appendText}`
          : parentUpdate.appendText;

        // Parent's introduction is unchanged here — carrying currentIntroduction
        // through without re-syncing the Bible entry avoids a wasted rewrite.
        await commitArticleContent(tx, {
          worldId,
          articleId,
          ownerId,
          introduction: currentIntroduction,
          description: appendedDesc,
          syncBibleIntroduction: false,
        });
      }

      childArticleId = childId;
      touchedArticleIds.add(childId);
    } else {
      const result = await commitArticleContent(tx, {
        worldId,
        articleId,
        ownerId,
        introduction: newIntroduction,
        description: newDescription,
        status: 'draft',
        expansionParams: draft.expansion_params,
        proposalUsed: draft.selected_proposal,
        syncBibleIntroduction: Boolean(newIntroduction),
      });
      versionId = result.versionId;
    }

    for (const warning of coherenceWarnings) {
      await tx.run(`
        INSERT INTO coherence_warnings
          (id, article_id, owner_id, source_article_id, severity, description, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
      `, [nanoid(), articleId, ownerId, warning.sourceArticleId ?? null, warning.severity, warning.description, now]);
    }

    for (const link of suggestedLinks) {
      if (!link.targetArticleId) continue;
      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'references')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [articleId, link.targetArticleId, ownerId]);
    }

    await markDraftAccepted({ worldId, articleId, ownerId, draftId, exec: tx });
  });

  await runSyncRules(worldId, articleId);
  if (childArticleId) await runSyncRules(worldId, childArticleId);
  for (const id of touchedArticleIds) {
    await reindexArticle(worldId, id);
  }

  const updatedArticle = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND owner_id = ?', [articleId, ownerId]);

  if (pipelineType === 'create_child' && childArticleId) {
    const childArticle = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND owner_id = ?', [childArticleId, ownerId]);
    const childVersion = await exec.get<DbRow>(
      'SELECT * FROM article_versions WHERE article_id = ? AND owner_id = ? ORDER BY version_number DESC LIMIT 1',
      [childArticleId, ownerId],
    );
    return {
      article: parseArticle(updatedArticle!),
      childArticle: parseArticle(childArticle!),
      childVersion: parseVersion(childVersion!),
    };
  }

  const newVersion = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ? AND owner_id = ?', [versionId, ownerId]);
  return {
    article: parseArticle(updatedArticle!),
    version: parseVersion(newVersion!),
  };
}
