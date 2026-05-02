import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the api module
// ---------------------------------------------------------------------------

const mockApi = vi.hoisted(() => ({
  articles: {
    list: vi.fn(),
    tree: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    versions: {
      list: vi.fn(),
      revert: vi.fn(),
    },
    draft: {
      get: vi.fn(),
      accept: vi.fn(),
      discard: vi.fn(),
    },
  },
  bible: {
    getMeta: vi.fn(),
  },
  worlds: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/api.ts', () => ({ api: mockApi }));

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

import { createStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { worldSlice } from './worldSlice.ts';
import { articleSlice } from './articleSlice.ts';
import { uiSlice } from './uiSlice.ts';
import { agentSlice } from './agentSlice.ts';

function makeStore() {
  return createStore(
    immer((...a: Parameters<typeof worldSlice>) => ({
      ...worldSlice(...a),
      ...articleSlice(...a),
      ...uiSlice(...a),
      ...agentSlice(...a),
    })),
  );
}

type Store = ReturnType<typeof makeStore>;

let store: Store;
beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore();
  // bible.getMeta is called by loadBibleMeta inside manualEdit / acceptDraft
  mockApi.bible.getMeta.mockResolvedValue({ tokenCount: 0, threshold: 80000 });
});

const S = () => store.getState();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const article1 = {
  id: 'art1',
  worldId: 'w1',
  title: 'The Dragon',
  status: 'draft' as const,
  templateType: 'general' as const,
  temporalAnchorStart: null,
  temporalAnchorEnd: null,
  isFixedPoint: false,
  depth: 1,
  currentVersionId: 'v1',
  createdAt: 1000,
  updatedAt: 1000,
};

const version1 = {
  id: 'v1',
  articleId: 'art1',
  versionNumber: 1,
  body: '## Description\n\nOriginal body.',
  summary: 'Original summary.',
  expansionParams: null,
  proposalUsed: null,
  wordCount: 3,
  isRevert: false,
  revertedFromVersionId: null,
  createdAt: 1000,
};

const articleDetail = {
  article: article1,
  version: version1,
  introduction: '',
  links: [],
  openWarnings: [],
};

const pendingDraft = {
  id: 'draft1',
  articleId: 'art1',
  selectedProposal: null,
  pipelineType: 'expand_description',
  autoSelect: false,
  expansionParams: {},
  phase: 'draft_ready',
  contextPackage: null,
  concepts: null,
  parentUpdate: null,
  draftContent: { description: 'New content.', coherenceWarnings: [], suggestedLinks: [] },
  createdAt: 1000,
  updatedAt: 1000,
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('has empty articles list', () => { expect(S().articles).toEqual([]); });
  it('has null currentArticleId', () => { expect(S().currentArticleId).toBeNull(); });
  it('has null currentArticleDetail', () => { expect(S().currentArticleDetail).toBeNull(); });
  it('has empty versions list', () => { expect(S().versions).toEqual([]); });
  it('has null pendingDraft', () => { expect(S().pendingDraft).toBeNull(); });
});

// ---------------------------------------------------------------------------
// loadArticles
// ---------------------------------------------------------------------------

describe('loadArticles', () => {
  it('populates articles from the api', async () => {
    mockApi.articles.list.mockResolvedValue([article1]);
    await S().loadArticles('w1');
    expect(S().articles).toEqual([article1]);
  });

  it('passes worldId to the api', async () => {
    mockApi.articles.list.mockResolvedValue([]);
    await S().loadArticles('w99');
    expect(mockApi.articles.list).toHaveBeenCalledWith('w99');
  });
});

// ---------------------------------------------------------------------------
// loadTree
// ---------------------------------------------------------------------------

describe('loadTree', () => {
  it('builds the treeNodes from a flat list', async () => {
    const flat = [
      { id: 'p', title: 'Parent', status: 'stub', depth: 1, parentId: null },
      { id: 'c', title: 'Child', status: 'stub', depth: 2, parentId: 'p' },
    ];
    mockApi.articles.tree.mockResolvedValue(flat);
    await S().loadTree('w1');
    expect(S().treeNodes).toHaveLength(1);
    expect(S().treeNodes[0].id).toBe('p');
    expect(S().treeNodes[0].children[0].id).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// selectArticle
// ---------------------------------------------------------------------------

describe('selectArticle', () => {
  it('sets currentArticleId immediately (optimistic reset)', async () => {
    mockApi.articles.get.mockResolvedValue(articleDetail);
    const promise = S().selectArticle('w1', 'art1');
    // The id is set synchronously before the api call resolves
    expect(S().currentArticleId).toBe('art1');
    await promise;
  });

  it('clears previous article detail before fetching (optimistic null)', async () => {
    store.setState((s) => {
      s.currentArticleDetail = articleDetail;
      s.pendingDraft = pendingDraft;
    });
    mockApi.articles.get.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(articleDetail), 10)),
    );
    const promise = S().selectArticle('w1', 'art2');
    // Before the api resolves, detail is null
    expect(S().currentArticleDetail).toBeNull();
    expect(S().pendingDraft).toBeNull();
    await promise;
  });

  it('populates currentArticleDetail after fetching', async () => {
    mockApi.articles.get.mockResolvedValue(articleDetail);
    await S().selectArticle('w1', 'art1');
    expect(S().currentArticleDetail).toEqual(articleDetail);
  });

  it('passes correct ids to the api', async () => {
    mockApi.articles.get.mockResolvedValue(articleDetail);
    await S().selectArticle('w1', 'art1');
    expect(mockApi.articles.get).toHaveBeenCalledWith('w1', 'art1');
  });
});

// ---------------------------------------------------------------------------
// loadVersions
// ---------------------------------------------------------------------------

describe('loadVersions', () => {
  it('populates versions from the api', async () => {
    mockApi.articles.versions.list.mockResolvedValue([version1]);
    await S().loadVersions('w1', 'art1');
    expect(S().versions).toEqual([version1]);
  });
});

// ---------------------------------------------------------------------------
// checkDraft
// ---------------------------------------------------------------------------

describe('checkDraft', () => {
  it('sets pendingDraft when draft exists', async () => {
    mockApi.articles.draft.get.mockResolvedValue(pendingDraft);
    await S().checkDraft('w1', 'art1');
    expect(S().pendingDraft).toEqual(pendingDraft);
  });

  it('sets pendingDraft to null when api throws (404 / no draft)', async () => {
    mockApi.articles.draft.get.mockRejectedValue(new Error('Not found'));
    await S().checkDraft('w1', 'art1');
    expect(S().pendingDraft).toBeNull();
  });

  it('does not propagate errors from the api', async () => {
    mockApi.articles.draft.get.mockRejectedValue(new Error('Server error'));
    await expect(S().checkDraft('w1', 'art1')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// manualEdit
// ---------------------------------------------------------------------------

describe('manualEdit', () => {
  const updatedArticle = { ...article1, updatedAt: 2000 };
  const updatedVersion = { ...version1, id: 'v2', versionNumber: 2, body: 'New body.' };

  beforeEach(() => {
    store.setState((s) => {
      s.articles = [article1];
      s.currentArticleDetail = articleDetail;
      s.currentWorldId = 'w1';
    });
    mockApi.articles.update.mockResolvedValue({
      article: updatedArticle,
      version: updatedVersion,
    });
  });

  it('updates the article in the articles list', async () => {
    await S().manualEdit('w1', 'art1', 'New body.');
    expect(S().articles[0]).toEqual(updatedArticle);
  });

  it('updates currentArticleDetail when it matches the edited article', async () => {
    await S().manualEdit('w1', 'art1', 'New body.');
    expect(S().currentArticleDetail!.article).toEqual(updatedArticle);
    expect(S().currentArticleDetail!.version).toEqual(updatedVersion);
  });

  it('does NOT update currentArticleDetail when it shows a different article', async () => {
    store.setState((s) => {
      s.currentArticleDetail = { ...articleDetail, article: { ...article1, id: 'other' } };
    });
    await S().manualEdit('w1', 'art1', 'New body.');
    // currentArticleDetail should still show the other article
    expect(S().currentArticleDetail!.article.id).toBe('other');
  });

  it('passes the existing summary to the api to preserve it', async () => {
    // currentArticleDetail has summary 'Original summary.'
    await S().manualEdit('w1', 'art1', 'New body.');
    expect(mockApi.articles.update).toHaveBeenCalledWith(
      'w1', 'art1',
      expect.objectContaining({ summary: 'Original summary.' }),
    );
  });

  it('calls loadBibleMeta after a successful edit', async () => {
    await S().manualEdit('w1', 'art1', 'New body.');
    expect(mockApi.bible.getMeta).toHaveBeenCalledWith('w1');
  });

  it('does not call loadBibleMeta when currentWorldId is null', async () => {
    store.setState((s) => { s.currentWorldId = null; });
    await S().manualEdit('w1', 'art1', 'New body.');
    expect(mockApi.bible.getMeta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// revertToVersion
// ---------------------------------------------------------------------------

describe('revertToVersion', () => {
  const revertedArticle = { ...article1, updatedAt: 3000 };
  const revertedVersion = { ...version1, id: 'v3', versionNumber: 3, isRevert: true };

  beforeEach(() => {
    store.setState((s) => {
      s.articles = [article1];
      s.currentArticleDetail = articleDetail;
    });
    mockApi.articles.versions.revert.mockResolvedValue({
      article: revertedArticle,
      version: revertedVersion,
    });
  });

  it('updates the article in the list', async () => {
    await S().revertToVersion('w1', 'art1', 'v1');
    expect(S().articles[0]).toEqual(revertedArticle);
  });

  it('updates currentArticleDetail version', async () => {
    await S().revertToVersion('w1', 'art1', 'v1');
    expect(S().currentArticleDetail!.version).toEqual(revertedVersion);
  });
});

// ---------------------------------------------------------------------------
// acceptDraft
// ---------------------------------------------------------------------------

describe('acceptDraft', () => {
  const acceptedArticle = { ...article1, updatedAt: 4000, status: 'reviewed' };
  const acceptedVersion = { ...version1, id: 'v2', versionNumber: 2 };

  beforeEach(() => {
    store.setState((s) => {
      s.articles = [article1];
      s.currentArticleDetail = articleDetail;
      s.pendingDraft = pendingDraft;
      s.currentWorldId = 'w1';
    });
    mockApi.articles.draft.accept.mockResolvedValue({
      article: acceptedArticle,
      version: acceptedVersion,
    });
  });

  it('updates the article in the list', async () => {
    await S().acceptDraft('w1', 'art1');
    expect(S().articles[0]).toEqual(acceptedArticle);
  });

  it('clears pendingDraft', async () => {
    await S().acceptDraft('w1', 'art1');
    expect(S().pendingDraft).toBeNull();
  });

  it('calls loadBibleMeta after accepting', async () => {
    await S().acceptDraft('w1', 'art1');
    expect(mockApi.bible.getMeta).toHaveBeenCalledWith('w1');
  });
});

// ---------------------------------------------------------------------------
// discardDraft
// ---------------------------------------------------------------------------

describe('discardDraft', () => {
  beforeEach(() => {
    store.setState((s) => { s.pendingDraft = pendingDraft; });
    mockApi.articles.draft.discard.mockResolvedValue(undefined);
  });

  it('clears pendingDraft', async () => {
    await S().discardDraft('w1', 'art1');
    expect(S().pendingDraft).toBeNull();
  });

  it('calls the discard api', async () => {
    await S().discardDraft('w1', 'art1');
    expect(mockApi.articles.draft.discard).toHaveBeenCalledWith('w1', 'art1');
  });
});

// ---------------------------------------------------------------------------
// clearCurrentArticle
// ---------------------------------------------------------------------------

describe('clearCurrentArticle', () => {
  it('resets all article-level state to null/empty', () => {
    store.setState((s) => {
      s.currentArticleId = 'art1';
      s.currentArticleDetail = articleDetail;
      s.versions = [version1];
      s.pendingDraft = pendingDraft;
    });
    S().clearCurrentArticle();
    expect(S().currentArticleId).toBeNull();
    expect(S().currentArticleDetail).toBeNull();
    expect(S().versions).toEqual([]);
    expect(S().pendingDraft).toBeNull();
  });

  it('does not touch the articles list', () => {
    store.setState((s) => { s.articles = [article1]; });
    S().clearCurrentArticle();
    expect(S().articles).toEqual([article1]);
  });
});
