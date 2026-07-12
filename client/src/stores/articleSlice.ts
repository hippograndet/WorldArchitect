import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';
import { buildTree, type TreeNode } from '../lib/tree.ts';
import type { Article, ArticleDetail, ArticleMetadataFact, ArticleVersion, PendingDraft } from '../types/article.ts';

export interface ArticleSlice {
  articles: Article[];
  treeNodes: TreeNode[];
  currentArticleId: string | null;
  currentArticleDetail: ArticleDetail | null;
  versions: ArticleVersion[];
  pendingDraft: PendingDraft | null;
  drafts: PendingDraft[];
  metadataFacts: ArticleMetadataFact[];
  metadataSuggestedFields: string[];

  loadArticles: (worldId: string) => Promise<void>;
  loadTree: (worldId: string) => Promise<void>;
  selectArticle: (worldId: string, articleId: string) => Promise<void>;
  loadVersions: (worldId: string, articleId: string) => Promise<void>;
  checkDraft: (worldId: string, articleId: string) => Promise<void>;
  manualEdit: (worldId: string, articleId: string, fields: { introduction?: string; description?: string; chronology?: string }) => Promise<void>;
  revertToVersion: (worldId: string, articleId: string, versionId: string) => Promise<void>;
  acceptDraft: (worldId: string, articleId: string, draftId?: string) => Promise<void>;
  discardDraft: (worldId: string, articleId: string, draftId?: string) => Promise<void>;
  loadMetadataFacts: (worldId: string, articleId: string) => Promise<void>;
  saveMetadataFacts: (worldId: string, articleId: string, facts: { key: string; value: unknown }[]) => Promise<void>;
  clearCurrentArticle: () => void;
}

export const articleSlice: StateCreator<StoreState, [['zustand/immer', never]], [], ArticleSlice> = (set, get) => ({
  articles: [],
  treeNodes: [],
  currentArticleId: null,
  currentArticleDetail: null,
  versions: [],
  pendingDraft: null,
  drafts: [],
  metadataFacts: [],
  metadataSuggestedFields: [],

  loadArticles: async (worldId) => {
    const articles = await api.articles.list(worldId);
    set((s) => { s.articles = articles; });
  },

  loadTree: async (worldId) => {
    const flat = await api.articles.tree(worldId);
    set((s) => { s.treeNodes = buildTree(flat); });
  },

  selectArticle: async (worldId, articleId) => {
    set((s) => {
      s.currentArticleId = articleId;
      s.currentArticleDetail = null;
      s.versions = [];
      s.pendingDraft = null;
      s.drafts = [];
    });
    const detail = await api.articles.get(worldId, articleId);
    set((s) => { s.currentArticleDetail = detail; });
  },

  loadVersions: async (worldId, articleId) => {
    const versions = await api.articles.versions.list(worldId, articleId);
    set((s) => { s.versions = versions; });
  },

  checkDraft: async (worldId, articleId) => {
    try {
      const drafts = await api.articles.draft.list(worldId, articleId, 'all');
      const pendingDraft = drafts.find((draft) => draft.status === 'pending') ?? null;
      set((s) => {
        s.drafts = drafts;
        s.pendingDraft = pendingDraft;
      });
    } catch {
      set((s) => {
        s.drafts = [];
        s.pendingDraft = null;
      });
    }
  },

  manualEdit: async (worldId, articleId, fields) => {
    const { article, version } = await api.articles.update(worldId, articleId, fields);
    set((s) => {
      const idx = s.articles.findIndex((a) => a.id === articleId);
      if (idx !== -1) s.articles[idx] = article;
      if (s.currentArticleDetail?.article.id === articleId) {
        s.currentArticleDetail.article = article;
        s.currentArticleDetail.version = version;
      }
    });
    const currentWorldId = get().currentWorldId;
    if (currentWorldId) await get().loadBibleMeta(currentWorldId);
  },

  revertToVersion: async (worldId, articleId, versionId) => {
    const { article, version } = await api.articles.versions.revert(worldId, articleId, versionId);
    set((s) => {
      const idx = s.articles.findIndex((a) => a.id === articleId);
      if (idx !== -1) s.articles[idx] = article;
      if (s.currentArticleDetail?.article.id === articleId) {
        s.currentArticleDetail.article = article;
        s.currentArticleDetail.version = version;
      }
    });
  },

  acceptDraft: async (worldId, articleId, draftId) => {
    const result = draftId
      ? await api.articles.draft.acceptById(worldId, articleId, draftId)
      : await api.articles.draft.accept(worldId, articleId);
    set((s) => {
      const idx = s.articles.findIndex((a) => a.id === articleId);
      if (idx !== -1) s.articles[idx] = result.article;
      if (s.currentArticleDetail?.article.id === articleId) {
        s.currentArticleDetail.article = result.article;
        if ('version' in result) {
          s.currentArticleDetail.version = result.version;
        }
      }
      if ('childArticle' in result) {
        const childIdx = s.articles.findIndex((a) => a.id === result.childArticle.id);
        if (childIdx === -1) {
          s.articles.push(result.childArticle);
        } else {
          s.articles[childIdx] = result.childArticle;
        }
      }
    });
    await get().checkDraft(worldId, articleId);
    const currentWorldId = get().currentWorldId;
    if (currentWorldId) await get().loadBibleMeta(currentWorldId);
  },

  discardDraft: async (worldId, articleId, draftId) => {
    if (draftId) {
      await api.articles.draft.discardById(worldId, articleId, draftId);
    } else {
      await api.articles.draft.discard(worldId, articleId);
    }
    await get().checkDraft(worldId, articleId);
  },

  loadMetadataFacts: async (worldId, articleId) => {
    const { facts, suggestedFields } = await api.metadata.list(worldId, articleId);
    set((s) => {
      s.metadataFacts = facts;
      s.metadataSuggestedFields = suggestedFields;
    });
  },

  saveMetadataFacts: async (worldId, articleId, facts) => {
    const { facts: saved } = await api.metadata.save(worldId, articleId, facts);
    set((s) => { s.metadataFacts = saved; });
  },

  clearCurrentArticle: () => {
    set((s) => {
      s.currentArticleId = null;
      s.currentArticleDetail = null;
      s.versions = [];
      s.pendingDraft = null;
      s.drafts = [];
      s.metadataFacts = [];
      s.metadataSuggestedFields = [];
    });
  },
});
