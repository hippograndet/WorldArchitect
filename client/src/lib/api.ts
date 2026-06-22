import type { World, CreateWorldInput, BibleMeta, WorldIssue } from '../types/world.ts';
import type { FlatArticle } from './tree.ts';
import type { Article, ArticleDetail, ArticleGraph, ArticleGraphEdge, ArticleVersion, PendingDraft, CoherenceWarning } from '../types/article.ts';
import type { ContextDepth, IdeaItem, EdgeProposal, GlobalWarning, StyleWardenResult } from '../types/agent.ts';

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json();

  if (!res.ok) {
    const raw = (data as { error?: unknown }).error ?? `HTTP ${res.status}`;
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(msg);
  }

  return data as T;
}

const get  = <T>(path: string)                 => request<T>('GET',    path);
const post = <T>(path: string, body?: unknown) => request<T>('POST',   path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH',  path, body);
const del  = (path: string)                    => request<void>('DELETE', path);

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="([^"]+)"/i) ?? contentDisposition.match(/filename=([^;]+)/i);
  return match?.[1]?.trim() ?? null;
}

export const api = {
  worlds: {
    list:   ()                            => get<World[]>('/worlds'),
    get:    (wid: string)                 => get<World>(`/worlds/${wid}`),
    create: (input: CreateWorldInput)     => post<{ world: World; rootArticleId: string }>('/worlds', input),
    update: (wid: string, input: Partial<CreateWorldInput>) => patch<World>(`/worlds/${wid}`, input),
    delete: (wid: string)                 => del(`/worlds/${wid}`),
    promptEngineer: (input: {
      fieldType: 'vibe' | 'writing_style' | 'distill' | 'article_brief' | 'intro_seed' | 'prompt_lab';
      rawText: string;
      worldName: string;
      worldDescription: string;
      currentVibe?: string;
      currentWritingStyle?: string;
      articleTitle?: string;
      articleType?: string;
      focus?: string;
      wid?: string;
    }) => {
      const path = input.wid
        ? `/worlds/${input.wid}/prompt-engineer`
        : '/worlds/prompt-engineer';
      return post<{ expandedDescription: string } | { vibe_append: string; writingStyle_append: string } | { userSpec: string } | { introduction: string }>(path, {
        fieldType:           input.fieldType,
        rawText:             input.rawText,
        worldName:           input.worldName,
        worldDescription:    input.worldDescription,
        currentVibe:         input.currentVibe,
        currentWritingStyle: input.currentWritingStyle,
        articleTitle:        input.articleTitle,
        articleType:         input.articleType,
        focus:               input.focus,
      });
    },
  },

  articles: {
    tree:   (wid: string)                 => get<FlatArticle[]>(`/worlds/${wid}/articles/tree`),
    graph:  (wid: string)                 => get<ArticleGraph>(`/worlds/${wid}/articles/graph`),
    list:   (wid: string, params?: { status?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.q)      qs.set('q', params.q);
      const query = qs.toString() ? `?${qs}` : '';
      return get<Article[]>(`/worlds/${wid}/articles${query}`);
    },
    get:    (wid: string, aid: string)    => get<ArticleDetail>(`/worlds/${wid}/articles/${aid}`),
    create: (wid: string, input: { title: string; templateType?: string; introduction?: string; description?: string; chronology?: string }) =>
      post<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles`, input),
    update: (wid: string, aid: string, input: { introduction?: string; description?: string; chronology?: string; status?: string; title?: string }) =>
      patch<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles/${aid}`, input),
    delete: (wid: string, aid: string)    => del(`/worlds/${wid}/articles/${aid}`),
    createLink: (wid: string, input: ArticleGraphEdge) =>
      post<ArticleGraphEdge>(`/worlds/${wid}/articles/links`, {
        sourceArticleId: input.source,
        targetArticleId: input.target,
        linkType: input.linkType,
      }),

    versions: {
      list:   (wid: string, aid: string)              => get<ArticleVersion[]>(`/worlds/${wid}/articles/${aid}/versions`),
      get:    (wid: string, aid: string, vid: string) => get<ArticleVersion>(`/worlds/${wid}/articles/${aid}/versions/${vid}`),
      revert: (wid: string, aid: string, vid: string) =>
        post<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles/${aid}/revert/${vid}`),
    },

    draft: {
      get:     (wid: string, aid: string)              => get<PendingDraft | null>(`/worlds/${wid}/articles/${aid}/draft`),
      accept:  (wid: string, aid: string, input?: { descriptionOverride?: string; introductionOverride?: string }) =>
        post<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles/${aid}/accept`, input ?? {}),
      discard: (wid: string, aid: string)              => del(`/worlds/${wid}/articles/${aid}/draft`),
    },

    batch: (wid: string, input: {
      parentArticleId: string;
      children: { title: string; introduction: string; templateType: string }[];
    }) => post<{ created: { id: string; title: string }[] }>(`/worlds/${wid}/articles/batch`, input),
  },

  bible: {
    getMeta:     (wid: string)                        => get<BibleMeta>(`/worlds/${wid}/bible`),
    updateEntry: (wid: string, aid: string, summary: string) =>
      patch<BibleMeta>(`/worlds/${wid}/bible/${aid}`, { summary }),
    render:      (wid: string)                        => get<{ markdown: string } & BibleMeta>(`/worlds/${wid}/bible/render`),
  },

  snapshots: {
    list:    (wid: string)              => get<{ id: string; name: string; created_at: number }[]>(`/worlds/${wid}/snapshots`),
    create:  (wid: string, name: string) =>
      post<{ id: string; name: string; created_at: number }>(`/worlds/${wid}/snapshots`, { name }),
    get:     (wid: string, sid: string) => get<{
      id: string; name: string; created_at: number;
      articleCount: number; articles: { id: string; title: string; status: string }[];
    }>(`/worlds/${wid}/snapshots/${sid}`),
    restore: (wid: string, sid: string) =>
      post<{ restored: string; autoSaved: { id: string; name: string } }>(`/worlds/${wid}/snapshots/${sid}/restore`),
    delete:  (wid: string, sid: string) => del(`/worlds/${wid}/snapshots/${sid}`),
  },

  agents: {
    estimate: (wid: string, extra?: { extraText?: string }) =>
      post<{ estimatedTokens: number }>(`/worlds/${wid}/agents/estimate`, extra ?? {}),
    propose: (wid: string, input: {
      articleId: string; pipelineType: string; userSpec?: string;
      autoSelect?: boolean; contextDepth?: ContextDepth;
    }) => post<{
      proposals: import('../types/agent.ts').Proposal[];
      autoSelectedIndex?: number;
      autoSelectRationale?: string;
    }>(`/worlds/${wid}/agents/propose`, input),
    expand: (wid: string, input: {
      articleId: string; pipelineType: string;
      selectedProposalIndex: number; proposals: import('../types/agent.ts').Proposal[];
      selectedIdeas?: IdeaItem[];
      userSpec?: string; contextDepth?: ContextDepth;
      runStyleWarden?: boolean;
      runContinuityEditor?: boolean;
      wordCountPreset?: 'short' | 'medium' | 'long';
    }) => post<{
      description: string;
      introduction?: string;
      parentUpdate?: { appendText: string };
      styleCheck?: StyleWardenResult;
    }>(`/worlds/${wid}/agents/expand`, input),
    proposeChildren: (wid: string, input: { articleId: string; contextDepth?: ContextDepth; userSpec?: string }) =>
      post<{ proposals: import('../types/agent.ts').ChildProposal[] }>(`/worlds/${wid}/agents/propose-children`, input),
    chronology: (wid: string, input: { articleId: string; userSpec?: string; contextDepth?: ContextDepth }) =>
      post<{ chronologySection: string; coherenceWarnings: CoherenceWarning[] }>(`/worlds/${wid}/agents/chronology`, input),
    summarize: (wid: string, input: { articleId: string; mode?: import('../types/agent.ts').SummarizerMode }) =>
      post<{ introduction: string }>(`/worlds/${wid}/agents/summarize`, input),
    reorganize: (wid: string, input: { articleId: string; userSpec?: string; contextDepth?: ContextDepth }) =>
      post<{
        description: string; introduction: string;
        retentionIssues: { description: string; severity: 'warning' | 'critical' }[];
        coherenceWarnings: CoherenceWarning[];
        suggestedLinks: { targetArticleTitle: string; targetArticleId: string | null }[];
      }>(`/worlds/${wid}/agents/reorganize`, input),
    cohere: (wid: string, input: { articleId: string; contextDepth?: ContextDepth }) =>
      post<{
        warnings: CoherenceWarning[];
        suggestedLinks: { targetArticleTitle: string; targetArticleId: string | null }[];
      }>(`/worlds/${wid}/agents/cohere`, input),
    compress: (wid: string) =>
      post<{ entries: { articleId: string; compressedSummary: string; tokensBefore: number; tokensAfter: number }[] }>(
        `/worlds/${wid}/agents/compress`,
      ),
    proposeIdeas: (wid: string, input: {
      articleId: string;
      introduction: string;
      selectedProposal: import('../types/agent.ts').Proposal;
      userSpec?: string;
      contextDepth?: ContextDepth;
    }) => post<{ ideas: IdeaItem[] }>(`/worlds/${wid}/agents/propose-ideas`, input),
    audit: (wid: string, input?: { sampleSize?: number; focus?: 'all' | 'recent' }) =>
      post<{ edgeProposals: EdgeProposal[]; globalWarnings: GlobalWarning[] }>(
        `/worlds/${wid}/agents/audit`, input ?? {},
      ),
    acceptEdge: (wid: string, input: { sourceArticleId: string; targetArticleId: string; linkType: 'references' | 'hierarchical' }) =>
      post<{ ok: true }>(`/worlds/${wid}/agents/audit/accept-edge`, input),
    auditProposals: (wid: string) =>
      get<{ proposals: (EdgeProposal & { id: string; status: string })[] }>(`/worlds/${wid}/agents/audit/proposals`),
  },

  settings: {
    get:         ()                    => get<{ provider: string; config: Record<string, string> }>('/settings'),
    update:      (input: { provider?: string; apiKey?: string; model?: string }) => patch<{ provider: string }>('/settings', input),
    test:        ()                    => post<{ ok: boolean; provider: string }>('/settings/test'),
    worldGet:    (wid: string)         => get<{ dailyCap: number | null; bibleThreshold: number }>(`/worlds/${wid}/settings`),
    worldUpdate: (wid: string, input: { dailyCap?: number | null; bibleThreshold?: number }) =>
      patch<{ dailyCap: number | null; bibleThreshold: number }>(`/worlds/${wid}/settings`, input),
  },

  callLog: {
    list: (wid: string, page = 1) =>
      get<{ entries: unknown[]; total: number; page: number }>(`/worlds/${wid}/call-log?page=${page}`),
  },

  export: {
    downloadUrl: (wid: string) => `${BASE}/worlds/${wid}/export`,
    download: async (wid: string) => {
      const res = await fetch(`${BASE}/worlds/${wid}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: unknown } | null;
        const raw = data?.error ?? `HTTP ${res.status}`;
        const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
        throw new Error(msg);
      }
      return {
        blob: await res.blob(),
        filename: parseDownloadFilename(res.headers.get('Content-Disposition')) ?? 'worldarchitect-export.zip',
      };
    },
  },

  names: {
    list: (wid: string, filter?: { entityType?: string; gender?: string; socialClass?: string; nameComponent?: string; tags?: string[] }) => {
      const qs = new URLSearchParams();
      if (filter?.entityType)    qs.set('entityType', filter.entityType);
      if (filter?.gender)        qs.set('gender', filter.gender);
      if (filter?.socialClass)   qs.set('socialClass', filter.socialClass);
      if (filter?.nameComponent) qs.set('nameComponent', filter.nameComponent);
      if (filter?.tags?.length)  qs.set('tags', filter.tags.join(','));
      const query = qs.toString() ? `?${qs}` : '';
      return get<import('../types/world.js').NameListResponse>(`/worlds/${wid}/names${query}`);
    },
    generate: (wid: string, profileId: string, entityType: string, count = 8, opts?: {
      gender?: string; socialClass?: string; nameComponent?: string;
    }) =>
      post<{ names: string[] }>(`/worlds/${wid}/names/generate`, { profileId, entityType, count, ...opts }),
    save: (wid: string, entries: Array<{
      name: string; profileId: string; entityType: string;
      gender?: string; socialClass?: string; nameComponent?: string;
      tags: string[]; source?: 'generated' | 'user';
    }>) =>
      post<{ names: import('../types/world.js').NameEntry[] }>(`/worlds/${wid}/names`, { names: entries }),
    delete: (wid: string, nid: string) => del(`/worlds/${wid}/names/${nid}`),
  },

  entityMentions: {
    list: (wid: string, status?: string) => {
      const qs = status ? `?status=${status}` : '';
      return get<import('../types/world.js').EntityMention[]>(`/worlds/${wid}/entity-mentions${qs}`);
    },
    ignore: (wid: string, mid: string) =>
      patch<import('../types/world.js').EntityMention>(`/worlds/${wid}/entity-mentions/${mid}`, { status: 'ignored' }),
  },

  issues: {
    list: (wid: string, aid: string) =>
      get<import('../types/world.js').ArticleIssue[]>(`/worlds/${wid}/articles/${aid}/issues`),
    updateStatus: (wid: string, aid: string, iid: string, status: 'open' | 'in_review' | 'dismissed' | 'fixed') =>
      patch<{ ok: boolean }>(`/worlds/${wid}/articles/${aid}/issues/${iid}`, { status }),
    dismiss: (wid: string, aid: string, iid: string) =>
      patch<{ ok: boolean }>(`/worlds/${wid}/articles/${aid}/issues/${iid}`, { status: 'dismissed' }),
    lint: (wid: string, aid: string) =>
      post<import('../types/world.js').ArticleIssue[]>(`/worlds/${wid}/articles/${aid}/lint`),
    worldSummary: (wid: string) =>
      get<{ blocking: number; warnings: number; total: number }>(`/worlds/${wid}/issues`),
    fix: (wid: string, aid: string, iid: string) =>
      post<{ rewrittenPassage: string }>(`/worlds/${wid}/articles/${aid}/issues/${iid}/fix`),
    applyFix: (wid: string, aid: string, iid: string, rewrittenPassage: string, excerpt: string) =>
      post<{ article: Record<string, unknown>; version: Record<string, unknown> }>(`/worlds/${wid}/articles/${aid}/issues/${iid}/apply-fix`, { rewrittenPassage, excerpt }),
  },

  worldIssues: {
    list: (wid: string, params?: { status?: string; severity?: string; type?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status)   qs.set('status', params.status);
      if (params?.severity) qs.set('severity', params.severity);
      if (params?.type)     qs.set('type', params.type);
      const query = qs.toString() ? `?${qs}` : '';
      return get<WorldIssue[]>(`/worlds/${wid}/world-issues${query}`);
    },
    update: (wid: string, iid: string, status: string) =>
      patch<{ ok: true }>(`/worlds/${wid}/world-issues/${iid}`, { status }),
    forArticle: (wid: string, aid: string) =>
      get<WorldIssue[]>(`/worlds/${wid}/articles/${aid}/world-issues`),
  },

  publish: {
    staged:  (wid: string) =>
      get<Array<{ id: string; title: string; status: string; templateType: string; depth: number; blockingIssues: number; warningIssues: number; health: string; updatedAt: number }>>(`/worlds/${wid}/publish/staged`),
    check:   (wid: string, articleIds: string[]) =>
      post<{ summary: { blocking: number; warnings: number; clean: number }; issues: import('../types/world.js').ArticleIssue[] }>(`/worlds/${wid}/publish/check`, { articleIds }),
    commit:  (wid: string, articleIds: string[], force?: boolean) =>
      post<{ published: string[]; publishedAt: number }>(`/worlds/${wid}/publish/commit`, { articleIds, force }),
    history: (wid: string) =>
      get<Array<{ id: string; articleId: string; articleTitle: string; versionId: string | null; publishedAt: number }>>(`/worlds/${wid}/publish/history`),
  },
};
