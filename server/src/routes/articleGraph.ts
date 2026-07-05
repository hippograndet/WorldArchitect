import { Router } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runSyncRules } from '../services/syncRules.js';
import { tenantIdFor } from '../tenant.js';

const router = Router({ mergeParams: true });

const CreateLinkSchema = z.object({
  sourceArticleId: z.string().min(1),
  targetArticleId: z.string().min(1),
  linkType: z.enum(['hierarchical', 'references']),
});

// GET /api/worlds/:wid/articles/tree — flat list with parentId for tree building
router.get('/tree', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;

  const rows = await getDbClient().all<{ id: string; title: string; status: string; depth: number; updated_at: number; parent_id: string | null }>(`
    SELECT a.id, a.title, a.status, a.depth, a.updated_at,
           al.source_article_id AS parent_id
    FROM articles a
    LEFT JOIN article_links al
      ON al.target_article_id = a.id AND al.link_type = 'hierarchical'
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.updated_at ASC
  `, [wid]);

  res.json(rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    depth: r.depth,
    parentId: r.parent_id ?? null,
  })));
}));

// GET /api/worlds/:wid/articles/graph — article network for graph view
router.get('/graph', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();

  const nodes = await exec.all<{
    id: string;
    title: string;
    status: string;
    template_type: string;
    depth: number;
    introduction: string;
  }>(`
    SELECT a.id, a.title, a.status, a.template_type, a.depth,
           COALESCE(av.introduction, '') AS introduction
    FROM articles a
    LEFT JOIN article_versions av ON av.id = a.current_version_id
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.title COLLATE NOCASE ASC
  `, [wid]);

  const edges = await exec.all<{
    source: string;
    target: string;
    linkType: 'hierarchical' | 'references';
  }>(`
    SELECT al.source_article_id AS source,
           al.target_article_id AS target,
           al.link_type AS linkType
    FROM article_links al
    JOIN articles source_article ON source_article.id = al.source_article_id
    JOIN articles target_article ON target_article.id = al.target_article_id
    WHERE source_article.world_id = ?
      AND target_article.world_id = ?
    ORDER BY al.link_type ASC
  `, [wid, wid]);

  res.json({
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      templateType: node.template_type,
      depth: node.depth ?? 1,
      introduction: node.introduction,
    })),
    edges,
  });
}));

// POST /api/worlds/:wid/articles/links — manually create or update an article edge
router.post('/links', asyncHandler(async (req, res) => {
  const parse = CreateLinkSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { sourceArticleId, targetArticleId, linkType } = parse.data;
  const wid = (req.params as Record<string, string>).wid;

  if (sourceArticleId === targetArticleId) {
    res.status(400).json({ error: 'An article cannot link to itself.' });
    return;
  }

  const exec = getDbClient();
  const articles = await exec.all<{ id: string; depth: number }>(`
    SELECT id, depth
    FROM articles
    WHERE world_id = ? AND id IN (?, ?)
  `, [wid, sourceArticleId, targetArticleId]);

  if (articles.length !== 2) {
    res.status(404).json({ error: 'Both articles must exist in this world.' });
    return;
  }

  const sourceArticle = articles.find((article) => article.id === sourceArticleId);
  const targetArticle = articles.find((article) => article.id === targetArticleId);
  if (!sourceArticle || !targetArticle) {
    res.status(404).json({ error: 'Both articles must exist in this world.' });
    return;
  }

  if (linkType === 'hierarchical') {
    const queue = [targetArticleId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === sourceArticleId) {
        res.status(400).json({ error: 'That hierarchical edge would create a cycle.' });
        return;
      }
      if (seen.has(currentId)) continue;
      seen.add(currentId);

      const children = await exec.all<{ id: string }>(`
        SELECT target_article_id AS id
        FROM article_links
        WHERE source_article_id = ? AND link_type = 'hierarchical'
      `, [currentId]);

      for (const child of children) queue.push(child.id);
    }
  }

  const now = Date.now();

  await exec.transaction(async (tx) => {
    if (linkType === 'hierarchical') {
      await tx.run(`
        DELETE FROM article_links
        WHERE target_article_id = ?
          AND link_type = 'hierarchical'
          AND source_article_id != ?
      `, [targetArticleId, sourceArticleId]);
    }

    await tx.run(`
      INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_article_id, target_article_id)
      DO UPDATE SET link_type = excluded.link_type
    `, [sourceArticleId, targetArticleId, tenantIdFor(req), linkType]);

    if (linkType === 'hierarchical') {
      const queue = [{ id: targetArticleId, depth: (sourceArticle.depth ?? 1) + 1 }];
      const seen = new Set<string>([sourceArticleId]);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (seen.has(current.id)) continue;
        seen.add(current.id);

        await tx.run('UPDATE articles SET depth = ?, updated_at = ? WHERE id = ?', [current.depth, now, current.id]);

        const children = await tx.all<{ id: string }>(`
          SELECT target_article_id AS id
          FROM article_links
          WHERE source_article_id = ? AND link_type = 'hierarchical'
        `, [current.id]);

        for (const child of children) {
          queue.push({ id: child.id, depth: current.depth + 1 });
        }
      }
    }

    await tx.run('UPDATE articles SET updated_at = ? WHERE id IN (?, ?)', [now, sourceArticleId, targetArticleId]);
  });

  await runSyncRules(wid, sourceArticleId);
  await runSyncRules(wid, targetArticleId);

  res.status(201).json({
    source: sourceArticleId,
    target: targetArticleId,
    linkType,
  });
}));

export default router;
