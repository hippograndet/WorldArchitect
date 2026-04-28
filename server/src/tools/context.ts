import { getDb } from '../db/index.js';
import { renderBible } from '../services/worldBible.js';
import type { Tool, ToolCall } from './types.js';

export const CONTEXT_TOOLS: Tool[] = [
  {
    name: 'get_world_bible',
    description:
      'Returns the World Bible as markdown: all article summaries grouped by category. Use this to understand the full world context before writing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_article',
    description: 'Returns the full body and metadata of a specific article by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: 'The article ID' },
      },
      required: ['articleId'],
    },
  },
  {
    name: 'search_articles',
    description:
      'Search articles by keyword (matches title and body). Returns titles and summaries of up to 10 matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_timeline',
    description:
      "Returns all articles that have temporal anchors, sorted chronologically. Use to understand the world's historical progression.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_article_links',
    description: 'Returns outgoing and incoming links for a specific article.',
    inputSchema: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: 'The article ID' },
      },
      required: ['articleId'],
    },
  },
];

export function executeContextTool(worldId: string, call: ToolCall): string {
  const db = getDb();

  switch (call.name) {
    case 'get_world_bible':
      return renderBible(worldId) || '(World Bible is empty)';

    case 'get_article': {
      const { articleId } = call.input as { articleId: string };
      const row = db
        .prepare(
          `SELECT a.id, a.title, a.template_type, a.temporal_anchor_start, a.temporal_anchor_end,
                  a.is_fixed_point, av.body, av.summary
           FROM articles a
           LEFT JOIN article_versions av ON av.id = a.current_version_id
           WHERE a.id = ? AND a.world_id = ?`,
        )
        .get(articleId, worldId) as Record<string, unknown> | undefined;
      if (!row) return JSON.stringify({ error: 'Article not found' });
      return JSON.stringify({
        id: row.id,
        title: row.title,
        templateType: row.template_type,
        temporalAnchorStart: row.temporal_anchor_start ?? null,
        temporalAnchorEnd: row.temporal_anchor_end ?? null,
        isFixedPoint: row.is_fixed_point === 1,
        summary: (row.summary as string) ?? '',
        body: (row.body as string) ?? '',
      });
    }

    case 'search_articles': {
      const { query } = call.input as { query: string };
      const rows = db
        .prepare(
          `SELECT a.id, a.title, av.summary
           FROM articles a
           LEFT JOIN article_versions av ON av.id = a.current_version_id
           WHERE a.world_id = ? AND (a.title LIKE ? OR av.body LIKE ?)
           LIMIT 10`,
        )
        .all(worldId, `%${query}%`, `%${query}%`) as Record<string, unknown>[];
      return JSON.stringify(
        rows.map((r) => ({ id: r.id, title: r.title, summary: (r.summary as string) ?? '' })),
      );
    }

    case 'get_timeline': {
      const rows = db
        .prepare(
          `SELECT a.id, a.title, a.temporal_anchor_start, a.temporal_anchor_end, av.summary
           FROM articles a
           LEFT JOIN article_versions av ON av.id = a.current_version_id
           WHERE a.world_id = ? AND a.temporal_anchor_start IS NOT NULL
           ORDER BY a.temporal_anchor_start ASC`,
        )
        .all(worldId) as Record<string, unknown>[];
      return JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          temporalAnchorStart: r.temporal_anchor_start,
          temporalAnchorEnd: r.temporal_anchor_end ?? null,
          summary: (r.summary as string) ?? '',
        })),
      );
    }

    case 'get_article_links': {
      const { articleId } = call.input as { articleId: string };
      const outgoing = db
        .prepare(
          `SELECT al.target_article_id AS id, a.title, al.link_type
           FROM article_links al JOIN articles a ON a.id = al.target_article_id
           WHERE al.source_article_id = ?`,
        )
        .all(articleId) as Record<string, unknown>[];
      const incoming = db
        .prepare(
          `SELECT al.source_article_id AS id, a.title, al.link_type
           FROM article_links al JOIN articles a ON a.id = al.source_article_id
           WHERE al.target_article_id = ?`,
        )
        .all(articleId) as Record<string, unknown>[];
      return JSON.stringify({ outgoing, incoming });
    }

    default:
      return JSON.stringify({ error: `Unknown context tool: ${call.name}` });
  }
}
