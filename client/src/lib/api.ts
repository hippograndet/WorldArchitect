import type { World, CreateWorldInput, BibleMeta } from '../types/world.ts';
import type { FlatArticle } from './tree.ts';
import type { Article, ArticleDetail, ArticleVersion, PendingDraft, CoherenceWarning } from '../types/article.ts';

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

export const api = {
  worlds: {
    list:   ()                            => get<World[]>('/worlds'),
    get:    (wid: string)                 => get<World>(`/worlds/${wid}`),
    create: (input: CreateWorldInput)     => post<{ world: World; rootArticleId: string }>('/worlds', input),
    update: (wid: string, input: Partial<CreateWorldInput>) => patch<World>(`/worlds/${wid}`, input),
    delete: (wid: string)                 => del(`/worlds/${wid}`),
  },

  articles: {
    tree:   (wid: string)                 => get<FlatArticle[]>(`/worlds/${wid}/articles/tree`),
    list:   (wid: string, params?: { status?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.q)      qs.set('q', params.q);
      const query = qs.toString() ? `?${qs}` : '';
      return get<Article[]>(`/worlds/${wid}/articles${query}`);
    },
    get:    (wid: string, aid: string)    => get<ArticleDetail>(`/worlds/${wid}/articles/${aid}`),
    create: (wid: string, input: { title: string; templateType?: string; body?: string; summary?: string }) =>
      post<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles`, input),
    update: (wid: string, aid: string, input: { body: string; summary?: string; status?: string; title?: string }) =>
      patch<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles/${aid}`, input),
    delete: (wid: string, aid: string)    => del(`/worlds/${wid}/articles/${aid}`),

    versions: {
      list:   (wid: string, aid: string)              => get<ArticleVersion[]>(`/worlds/${wid}/articles/${aid}/versions`),
      get:    (wid: string, aid: string, vid: string) => get<ArticleVersion>(`/worlds/${wid}/articles/${aid}/versions/${vid}`),
      revert: (wid: string, aid: string, vid: string) =>
        post<{ article: Article; version: ArticleVersion }>(`/worlds/${wid}/articles/${aid}/revert/${vid}`),
    },

    draft: {
      get:     (wid: string, aid: string)              => get<PendingDraft | null>(`/worlds/${wid}/articles/${aid}/draft`),
      accept:  (wid: string, aid: string, input?: { bodyOverride?: string; summaryOverride?: string }) =>
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
    propose: (wid: string, input: { articleId: string; pipelineType: string; userSpec?: string }) =>
      post<{ proposals: import('../types/agent.ts').Proposal[] }>(`/worlds/${wid}/agents/propose`, input),
    expand: (wid: string, input: {
      articleId: string; pipelineType: string;
      selectedProposalIndex: number; proposals: import('../types/agent.ts').Proposal[];
      userSpec?: string;
    }) => post<{
      description?: string; introduction?: string;
      coherenceWarnings: CoherenceWarning[];
      suggestedLinks: { targetArticleTitle: string; targetArticleId: string | null }[];
      parentUpdate?: { articleId: string; appendText: string };
    }>(`/worlds/${wid}/agents/expand`, input),
    proposeChildren: (wid: string, input: { articleId: string }) =>
      post<{ proposals: import('../types/agent.ts').ChildProposal[] }>(`/worlds/${wid}/agents/propose-children`, input),
    chronology: (wid: string, input: { articleId: string; userSpec?: string }) =>
      post<{ chronologySection: string; coherenceWarnings: CoherenceWarning[] }>(`/worlds/${wid}/agents/chronology`, input),
    summarize: (wid: string, input: { articleId: string }) =>
      post<{ introduction: string }>(`/worlds/${wid}/agents/summarize`, input),
    reorganize: (wid: string, input: { articleId: string; userSpec?: string }) =>
      post<{
        description: string; introduction: string;
        retentionIssues: { description: string; severity: 'warning' | 'critical' }[];
        coherenceWarnings: CoherenceWarning[];
        suggestedLinks: { targetArticleTitle: string; targetArticleId: string | null }[];
      }>(`/worlds/${wid}/agents/reorganize`, input),
    cohere: (wid: string, input: { articleId: string }) =>
      post<{
        warnings: CoherenceWarning[];
        suggestedLinks: { targetArticleTitle: string; targetArticleId: string | null }[];
      }>(`/worlds/${wid}/agents/cohere`, input),
    compress: (wid: string) =>
      post<{ entries: { articleId: string; compressedSummary: string; tokensBefore: number; tokensAfter: number }[] }>(
        `/worlds/${wid}/agents/compress`,
      ),
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
  },
};
