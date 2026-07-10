import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { requireArticleForTenant, type DbRow } from '../services/articlesMapper.js';
import { suggestedMetadataFields } from '../services/articleMetadataFields.js';

const router = Router({ mergeParams: true });

function parseFact(row: DbRow) {
  return {
    id: row.id,
    articleId: row.article_id,
    subjectType: row.subject_type ?? null,
    key: row.key,
    value: JSON.parse(row.value as string) as unknown,
    authority: row.authority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SaveFactsSchema = z.object({
  facts: z.array(z.object({
    key: z.string().min(1).max(100),
    value: z.unknown(),
  })).max(50),
});

// GET /api/worlds/:wid/articles/:aid/metadata
router.get('/:aid/metadata', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = await exec.all<DbRow>(
    `SELECT * FROM article_metadata_facts WHERE article_id = ? AND owner_id = ? ORDER BY key`,
    [(req.params as Record<string, string>).aid, tenant.ownerId],
  );

  res.json({
    facts: rows.map(parseFact),
    suggestedFields: suggestedMetadataFields(article.template_type as string),
  });
}));

// PATCH /api/worlds/:wid/articles/:aid/metadata — replaces the full fact set
router.patch('/:aid/metadata', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const aid = (req.params as Record<string, string>).aid;
  const article = await requireArticleForTenant(exec, tenant, aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const parse = SaveFactsSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid facts payload', details: parse.error.flatten() }); return; }

  const now = Date.now();
  const keys = parse.data.facts.map((f) => f.key);

  await exec.transaction(async (tx) => {
    if (keys.length > 0) {
      const placeholders = keys.map(() => '?').join(', ');
      await tx.run(
        `DELETE FROM article_metadata_facts WHERE article_id = ? AND owner_id = ? AND key NOT IN (${placeholders})`,
        [aid, tenant.ownerId, ...keys],
      );
    } else {
      await tx.run(`DELETE FROM article_metadata_facts WHERE article_id = ? AND owner_id = ?`, [aid, tenant.ownerId]);
    }

    for (const fact of parse.data.facts) {
      await tx.run(`
        INSERT INTO article_metadata_facts
          (id, owner_id, world_id, article_id, subject_type, key, value, authority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'user_confirmed', ?, ?)
        ON CONFLICT(article_id, key) DO UPDATE SET
          value      = excluded.value,
          authority  = 'user_confirmed',
          updated_at = excluded.updated_at
      `, [nanoid(), tenant.ownerId, tenant.worldId, aid, article.template_type, fact.key, JSON.stringify(fact.value ?? null), now, now]);
    }
  });

  const rows = await exec.all<DbRow>(
    `SELECT * FROM article_metadata_facts WHERE article_id = ? AND owner_id = ? ORDER BY key`,
    [aid, tenant.ownerId],
  );
  res.json({ facts: rows.map(parseFact) });
}));

export default router;
