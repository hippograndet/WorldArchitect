import { getDbClient } from '../db/client.js';
import { ownerParams, ownerPredicate, worldOwnerParams, worldOwnerPredicate } from '../db/tenantScope.js';
import { renderBible } from '../services/worldBible.js';
import { listNames, type ListNamesFilter } from '../services/nameBank.js';
import { dataBlock } from '../prompts/shared.js';
import type { Tool, ToolCall } from './types.js';

// Individually exported so agents can cherry-pick a subset instead of the
// whole bundle or nothing — see BaseAgent.getContextTools() overrides.
export const GET_WORLD_BIBLE_TOOL: Tool = {
  name: 'get_world_bible',
  description:
    'Returns the World Bible as markdown: all article summaries grouped by category. Use this to understand the full world context before writing.',
  inputSchema: { type: 'object', properties: {} },
};

export const GET_ARTICLE_TOOL: Tool = {
  name: 'get_article',
  description: 'Returns the full body and metadata of a specific article by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      articleId: { type: 'string', description: 'The article ID' },
    },
    required: ['articleId'],
  },
};

export const SEARCH_ARTICLES_TOOL: Tool = {
  name: 'search_articles',
  description:
    'Search articles by keyword (matches title and description). Call this when you need to find an article by name or topic and don\'t already have its ID. Returns titles and introductions of up to 10 ranked matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
};

export const GET_ARTICLE_LINKS_TOOL: Tool = {
  name: 'get_article_links',
  description: 'Returns outgoing and incoming links for a specific article.',
  inputSchema: {
    type: 'object',
    properties: {
      articleId: { type: 'string', description: 'The article ID' },
    },
    required: ['articleId'],
  },
};

export const CONTEXT_TOOLS: Tool[] = [
  GET_WORLD_BIBLE_TOOL,
  GET_ARTICLE_TOOL,
  SEARCH_ARTICLES_TOOL,
  GET_ARTICLE_LINKS_TOOL,
];

// Opt-in tool — NOT included in CONTEXT_TOOLS. Creative agents add this explicitly.
export const LOOKUP_NAMES_TOOL: Tool = {
  name: 'lookup_names',
  description:
    'Returns names from the world\'s name bank. Use to stay consistent with established naming conventions before inventing new names.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        enum: ['person', 'place', 'faction', 'concept'],
        description: 'Filter by entity type (optional)',
      },
      gender: {
        type: 'string',
        enum: ['male', 'female', 'neutral'],
        description: 'Filter person names by gender (optional)',
      },
      social_class: {
        type: 'string',
        enum: ['common', 'noble'],
        description: 'Filter by social class (optional)',
      },
      name_component: {
        type: 'string',
        enum: ['full', 'first', 'family'],
        description: 'Filter by name component — use "family" to retrieve canonical family names (optional)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags, e.g. region or faction name (optional)',
      },
    },
  },
};

export async function executeContextTool(worldId: string, call: ToolCall, ownerId?: string): Promise<string> {
  const exec = getDbClient();

  switch (call.name) {
    case 'get_world_bible':
      return dataBlock('worldBible', (await renderBible(worldId, ownerId)) || '(World Bible is empty)');

    case 'get_article': {
      const { articleId } = call.input as { articleId: string };
      const row = await exec.get<Record<string, unknown>>(
        `SELECT a.id, a.title, a.template_type, a.temporal_anchor_start, a.temporal_anchor_end,
                a.is_fixed_point, av.introduction, av.description, av.chronology
         FROM articles a
         LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', ownerId)}
         WHERE a.id = ? AND ${worldOwnerPredicate('a', ownerId)}`,
        [...ownerParams(ownerId), articleId, ...worldOwnerParams(worldId, ownerId)],
      );
      if (!row) return JSON.stringify({ error: 'Article not found' });
      return dataBlock('article', {
        id: row.id,
        title: row.title,
        templateType: row.template_type,
        temporalAnchorStart: row.temporal_anchor_start ?? null,
        temporalAnchorEnd: row.temporal_anchor_end ?? null,
        isFixedPoint: row.is_fixed_point === 1,
        introduction: (row.introduction as string) ?? '',
        description: (row.description as string) ?? '',
        chronology: (row.chronology as string) ?? '',
      });
    }

    case 'search_articles': {
      const { query } = call.input as { query: string };

      const rows = await exec.all<Record<string, unknown>>(
        `SELECT a.id, a.title, av.introduction
         FROM article_search_index s
         JOIN articles a ON a.id = s.article_id
         LEFT JOIN article_versions av ON av.id = a.current_version_id${ownerPredicate('av', ownerId)}
         WHERE s.world_id = ?${ownerPredicate('a', ownerId)}
           AND s.search_vector @@ plainto_tsquery('english', ?)
         ORDER BY ts_rank(s.search_vector, plainto_tsquery('english', ?)) DESC
         LIMIT 10`,
        [...ownerParams(ownerId), worldId, ...ownerParams(ownerId), query, query],
      );
      return dataBlock('searchResults',
        rows.map((r) => ({ id: r.id, title: r.title, introduction: (r.introduction as string) ?? '' })),
      );
    }

    case 'get_article_links': {
      const { articleId } = call.input as { articleId: string };
      // Scoped by world_id on both ends (like get_article) so a model-supplied
      // articleId from outside this world can't surface another world's titles.
      const outgoing = await exec.all<Record<string, unknown>>(
        `SELECT al.target_article_id AS id, a.title, al.link_type
         FROM article_links al
         JOIN articles src ON src.id = al.source_article_id
         JOIN articles a ON a.id = al.target_article_id
         WHERE al.source_article_id = ?
           AND ${worldOwnerPredicate('src', ownerId)}
           AND ${worldOwnerPredicate('a', ownerId)}${ownerPredicate('al', ownerId)}`,
        [articleId, ...worldOwnerParams(worldId, ownerId), ...worldOwnerParams(worldId, ownerId), ...ownerParams(ownerId)],
      );
      const incoming = await exec.all<Record<string, unknown>>(
        `SELECT al.source_article_id AS id, a.title, al.link_type
         FROM article_links al
         JOIN articles tgt ON tgt.id = al.target_article_id
         JOIN articles a ON a.id = al.source_article_id
         WHERE al.target_article_id = ?
           AND ${worldOwnerPredicate('tgt', ownerId)}
           AND ${worldOwnerPredicate('a', ownerId)}${ownerPredicate('al', ownerId)}`,
        [articleId, ...worldOwnerParams(worldId, ownerId), ...worldOwnerParams(worldId, ownerId), ...ownerParams(ownerId)],
      );
      return dataBlock('articleLinks', { outgoing, incoming });
    }

    case 'lookup_names': {
      const { entity_type, gender, social_class, name_component, tags } = call.input as {
        entity_type?: string; gender?: string; social_class?: string; name_component?: string; tags?: string[];
      };
      const filter: ListNamesFilter = {
        entityType:    entity_type as ListNamesFilter['entityType'],
        gender:        gender as ListNamesFilter['gender'],
        socialClass:   social_class as ListNamesFilter['socialClass'],
        nameComponent: name_component as ListNamesFilter['nameComponent'],
        tags,
      };
      const entries = await listNames(worldId, filter, undefined, ownerId);
      return dataBlock('nameBank', entries.map((e) => ({
        name: e.name, entityType: e.entityType,
        gender: e.gender, socialClass: e.socialClass, nameComponent: e.nameComponent, tags: e.tags,
      })));
    }

    default:
      return JSON.stringify({ error: `Unknown context tool: ${call.name}` });
  }
}
