import { getDbClient } from '../db/client.js';

export type InboxLane = 'drafts' | 'publish' | 'flags' | 'suggestions' | 'concepts' | 'run_checkpoints' | 'history';

type DbRow = Record<string, unknown>;

export interface InboxItem {
  id: string;
  lane: InboxLane;
  kind: string;
  title: string;
  status: string;
  severity: string | null;
  articleIds: string[];
  createdAt: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface InboxCount {
  open: number;
  byLane: Partial<Record<InboxLane, number>>;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function listInboxItems(worldId: string, ownerId: string): Promise<InboxItem[]> {
  const exec = getDbClient();
  const items: InboxItem[] = [];

  const drafts = await exec.all<DbRow>(
    `SELECT pd.*, a.title AS article_title
       FROM pending_drafts pd
       JOIN articles a ON a.id = pd.article_id AND a.owner_id = pd.owner_id
      WHERE pd.world_id = ? AND pd.owner_id = ? AND pd.status = 'pending'
      ORDER BY pd.created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of drafts) {
    items.push({
      id: row.id as string,
      lane: 'drafts',
      kind: row.pipeline_type as string,
      title: (row.display_title as string | null) ?? `Draft for ${row.article_title as string}`,
      status: row.status as string,
      severity: null,
      articleIds: [row.article_id as string],
      createdAt: row.created_at as number,
      source: (row.run_type as string | null) ?? (row.pipeline_type as string),
      payload: {
        articleTitle: row.article_title,
        articleId: row.article_id,
        draftId: row.id,
        sourceRunId: row.source_run_id ?? null,
        contextBasis: row.context_basis,
      },
    });
  }

  const publishRows = await exec.all<DbRow>(
    `SELECT a.id, a.title, a.status, a.template_type, a.depth, a.updated_at,
            a.current_version_id, a.published_version_id,
            COALESCE(blocking.cnt, 0) AS blocking_issues,
            COALESCE(warn.cnt, 0) AS warning_issues
       FROM articles a
       LEFT JOIN (
         SELECT article_id, COUNT(*) AS cnt
           FROM article_issues
          WHERE owner_id = ? AND severity = 'blocking' AND status = 'open'
          GROUP BY article_id
       ) blocking ON blocking.article_id = a.id
       LEFT JOIN (
         SELECT article_id, COUNT(*) AS cnt
           FROM article_issues
          WHERE owner_id = ? AND severity = 'warning' AND status = 'open'
          GROUP BY article_id
       ) warn ON warn.article_id = a.id
      WHERE a.world_id = ? AND a.owner_id = ?
        AND (a.status = 'draft' OR (a.status = 'published' AND a.current_version_id IS DISTINCT FROM a.published_version_id))
      ORDER BY a.updated_at DESC
      LIMIT 100`,
    [ownerId, ownerId, worldId, ownerId],
  );
  for (const row of publishRows) {
    const blocking = Number(row.blocking_issues ?? 0);
    const warnings = Number(row.warning_issues ?? 0);
    items.push({
      id: `publish:${row.id as string}`,
      lane: 'publish',
      kind: 'publish_article',
      title: row.title as string,
      status: row.status as string,
      severity: blocking > 0 ? 'blocking' : warnings > 0 ? 'warning' : null,
      articleIds: [row.id as string],
      createdAt: row.updated_at as number,
      source: 'publish',
      payload: {
        templateType: row.template_type,
        depth: row.depth,
        blockingIssues: blocking,
        warningIssues: warnings,
        currentVersionId: row.current_version_id ?? null,
        publishedVersionId: row.published_version_id ?? null,
      },
    });
  }

  const articleIssues = await exec.all<DbRow>(
    `SELECT ai.*, a.title AS article_title
       FROM article_issues ai
       JOIN articles a ON a.id = ai.article_id AND a.owner_id = ai.owner_id
      WHERE ai.world_id = ? AND ai.owner_id = ? AND ai.status IN ('open', 'in_review')
      ORDER BY ai.created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of articleIssues) {
    items.push({
      id: row.id as string,
      lane: 'flags',
      kind: 'article_issue',
      title: row.explanation as string,
      status: row.status as string,
      severity: row.severity as string,
      articleIds: [row.article_id as string],
      createdAt: row.created_at as number,
      source: row.source as string,
      payload: {
        articleTitle: row.article_title,
        articleId: row.article_id,
        code: row.code ?? null,
        excerpt: row.excerpt ?? null,
        suggestion: row.suggestion ?? null,
      },
    });
  }

  const worldIssues = await exec.all<DbRow>(
    `SELECT * FROM world_issues
      WHERE world_id = ? AND owner_id = ? AND status IN ('open', 'in_review')
      ORDER BY created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of worldIssues) {
    const articleIds = parseJsonArray(row.article_ids);
    items.push({
      id: row.id as string,
      lane: 'flags',
      kind: 'world_issue',
      title: row.description as string,
      status: row.status as string,
      severity: row.severity as string,
      articleIds,
      createdAt: row.created_at as number,
      source: row.source as string,
      payload: {
        type: row.type,
        articleIds,
      },
    });
  }

  const proposals = await exec.all<DbRow>(
    `SELECT aep.*, sa.title AS source_title, ta.title AS target_title
       FROM auditor_edge_proposals aep
       JOIN articles sa ON sa.id = aep.source_article_id AND sa.owner_id = aep.owner_id
       JOIN articles ta ON ta.id = aep.target_article_id AND ta.owner_id = aep.owner_id
      WHERE aep.world_id = ? AND aep.owner_id = ? AND aep.status = 'pending'
      ORDER BY aep.created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of proposals) {
    items.push({
      id: row.id as string,
      lane: 'suggestions',
      kind: 'edge_proposal',
      title: `${row.source_title as string} -> ${row.target_title as string}`,
      status: row.status as string,
      severity: null,
      articleIds: [row.source_article_id as string, row.target_article_id as string],
      createdAt: row.created_at as number,
      source: 'auditor',
      payload: {
        sourceArticleId: row.source_article_id,
        sourceTitle: row.source_title,
        targetArticleId: row.target_article_id,
        targetTitle: row.target_title,
        linkType: row.link_type,
        rationale: row.rationale,
      },
    });
  }

  const mentions = await exec.all<DbRow>(
    `SELECT em.*, a.title AS source_title
       FROM entity_mentions em
       JOIN articles a ON a.id = em.source_article_id AND a.owner_id = em.owner_id
      WHERE em.world_id = ? AND em.owner_id = ? AND em.status = 'pending'
      ORDER BY em.created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of mentions) {
    items.push({
      id: row.id as string,
      lane: 'concepts',
      kind: 'entity_mention',
      title: row.title as string,
      status: row.status as string,
      severity: null,
      articleIds: [row.source_article_id as string],
      createdAt: row.created_at as number,
      source: 'mention_extractor',
      payload: {
        sourceArticleId: row.source_article_id,
        sourceTitle: row.source_title,
        articleId: row.article_id ?? null,
        templateType: row.template_type,
        summary: row.summary ?? null,
      },
    });
  }

  const checkpoints = await exec.all<DbRow>(
    `SELECT ri.*, r.status AS run_status, r.graph_type, r.run_config
       FROM run_review_items ri
       JOIN runs r ON r.id = ri.run_id AND r.owner_id = ri.owner_id AND r.world_id = ri.world_id
      WHERE ri.world_id = ? AND ri.owner_id = ? AND ri.status = 'pending'
        AND r.status IN ('running', 'paused', 'needs_input', 'pending')
      ORDER BY ri.created_at DESC
      LIMIT 100`,
    [worldId, ownerId],
  );
  for (const row of checkpoints) {
    const payload = parseJsonObject(row.payload_json);
    items.push({
      id: row.id as string,
      lane: 'run_checkpoints',
      kind: row.kind as string,
      title: typeof payload.title === 'string' ? payload.title : `${row.step as string} review`,
      status: row.status as string,
      severity: null,
      articleIds: row.article_id ? [row.article_id as string] : [],
      createdAt: row.created_at as number,
      source: row.graph_type as string,
      payload: {
        ...payload,
        runId: row.run_id,
        runStatus: row.run_status,
        graphType: row.graph_type,
      },
    });
  }

  const history = await exec.all<DbRow>(
    `SELECT id, graph_type, status, article_ids, error_message, updated_at, created_at
       FROM runs
      WHERE world_id = ? AND owner_id = ? AND status IN ('completed', 'failed', 'stopped')
      ORDER BY updated_at DESC
      LIMIT 25`,
    [worldId, ownerId],
  );
  for (const row of history) {
    items.push({
      id: row.id as string,
      lane: 'history',
      kind: 'run',
      title: `${row.graph_type as string} run`,
      status: row.status as string,
      severity: row.status === 'failed' || row.status === 'stopped' ? 'warning' : null,
      articleIds: parseJsonArray(row.article_ids),
      createdAt: (row.updated_at as number) ?? (row.created_at as number),
      source: row.graph_type as string,
      payload: {
        errorMessage: row.error_message ?? null,
      },
    });
  }

  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

export async function countInboxItems(worldId: string, ownerId: string): Promise<InboxCount> {
  const items = await listInboxItems(worldId, ownerId);
  const byLane = items.reduce<Partial<Record<InboxLane, number>>>((acc, item) => {
    if (item.lane !== 'history') acc[item.lane] = (acc[item.lane] ?? 0) + 1;
    return acc;
  }, {});
  return {
    open: Object.values(byLane).reduce((sum, count) => sum + (count ?? 0), 0),
    byLane,
  };
}
