import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the api module before any store imports resolve it
// ---------------------------------------------------------------------------

const mockApi = vi.hoisted(() => ({
  worlds: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  bible: {
    getMeta: vi.fn(),
  },
}));

vi.mock('../lib/api.ts', () => ({ api: mockApi }));

// ---------------------------------------------------------------------------
// Store factory (fresh instance per test to avoid state leakage)
// ---------------------------------------------------------------------------

import { createStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { worldSlice } from './worldSlice.ts';
import { articleSlice } from './articleSlice.ts';
import { uiSlice } from './uiSlice.ts';
import { agentSlice } from './agentSlice.ts';
import { forgeSlice } from './forgeSlice.ts';

function makeStore() {
  return createStore(
    immer((...a: Parameters<typeof worldSlice>) => ({
      ...worldSlice(...a),
      ...articleSlice(...a),
      ...uiSlice(...a),
      ...agentSlice(...a),
      ...forgeSlice(...a),
    })),
  );
}

type Store = ReturnType<typeof makeStore>;

let store: Store;
beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore();
});

const S = () => store.getState();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const worldA = {
  id: 'w1',
  name: 'Middle-Earth',
  description: 'A vast world.',
  tags: [],
  tone: 'narrative' as const,
  originPoint: null,
  createdAt: 1000,
  updatedAt: 1000,
};

const worldB = {
  id: 'w2',
  name: 'Westeros',
  description: 'A land of ice and fire.',
  tags: [],
  tone: 'academic' as const,
  originPoint: null,
  createdAt: 2000,
  updatedAt: 2000,
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('has empty worlds list', () => {
    expect(S().worlds).toEqual([]);
  });

  it('has null currentWorldId', () => {
    expect(S().currentWorldId).toBeNull();
  });

  it('has zero bibleTokenCount', () => {
    expect(S().bibleTokenCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadWorlds
// ---------------------------------------------------------------------------

describe('loadWorlds', () => {
  it('populates worlds from the api', async () => {
    mockApi.worlds.list.mockResolvedValue([worldA, worldB]);
    await S().loadWorlds();
    expect(S().worlds).toEqual([worldA, worldB]);
  });

  it('replaces existing worlds on successive calls', async () => {
    mockApi.worlds.list.mockResolvedValueOnce([worldA]).mockResolvedValueOnce([worldB]);
    await S().loadWorlds();
    await S().loadWorlds();
    expect(S().worlds).toEqual([worldB]);
  });

  it('propagates api errors', async () => {
    mockApi.worlds.list.mockRejectedValue(new Error('Network error'));
    await expect(S().loadWorlds()).rejects.toThrow('Network error');
  });
});

// ---------------------------------------------------------------------------
// selectWorld
// ---------------------------------------------------------------------------

describe('selectWorld', () => {
  it('sets currentWorldId', () => {
    S().selectWorld('w1');
    expect(S().currentWorldId).toBe('w1');
  });

  it('updates currentWorldId when called again', () => {
    S().selectWorld('w1');
    S().selectWorld('w2');
    expect(S().currentWorldId).toBe('w2');
  });
});

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------

describe('createWorld', () => {
  it('prepends the new world to the worlds list', async () => {
    store.setState((s) => { s.worlds = [worldB]; });
    mockApi.worlds.create.mockResolvedValue({ world: worldA, rootArticleId: 'art1' });
    await S().createWorld({ name: 'Middle-Earth', description: 'A vast world.', tags: [], tone: 'narrative' });
    expect(S().worlds[0]).toEqual(worldA);
    expect(S().worlds[1]).toEqual(worldB);
  });

  it('sets currentWorldId to the new world', async () => {
    mockApi.worlds.create.mockResolvedValue({ world: worldA, rootArticleId: 'art1' });
    await S().createWorld({ name: 'x', description: 'y', tags: [], tone: 'narrative' });
    expect(S().currentWorldId).toBe('w1');
  });

  it('returns the created world and rootArticleId', async () => {
    mockApi.worlds.create.mockResolvedValue({ world: worldA, rootArticleId: 'art1' });
    const result = await S().createWorld({ name: 'x', description: 'y', tags: [], tone: 'narrative' });
    expect(result.world).toEqual(worldA);
    expect(result.rootArticleId).toBe('art1');
  });

  it('propagates api errors without mutating state', async () => {
    store.setState((s) => { s.worlds = [worldB]; });
    mockApi.worlds.create.mockRejectedValue(new Error('Server error'));
    await expect(S().createWorld({ name: 'x', description: 'y', tags: [], tone: 'narrative' })).rejects.toThrow();
    expect(S().worlds).toEqual([worldB]);
  });
});

// ---------------------------------------------------------------------------
// deleteWorld
// ---------------------------------------------------------------------------

describe('deleteWorld', () => {
  beforeEach(() => {
    store.setState((s) => { s.worlds = [worldA, worldB]; });
    mockApi.worlds.delete.mockResolvedValue(undefined);
  });

  it('removes the world from the list', async () => {
    await S().deleteWorld('w1');
    expect(S().worlds).toHaveLength(1);
    expect(S().worlds[0].id).toBe('w2');
  });

  it('clears currentWorldId when the current world is deleted', async () => {
    store.setState((s) => { s.currentWorldId = 'w1'; });
    await S().deleteWorld('w1');
    expect(S().currentWorldId).toBeNull();
  });

  it('does NOT clear currentWorldId when a different world is deleted', async () => {
    store.setState((s) => { s.currentWorldId = 'w2'; });
    await S().deleteWorld('w1');
    expect(S().currentWorldId).toBe('w2');
  });

  it('calls the api with the correct world id', async () => {
    await S().deleteWorld('w1');
    expect(mockApi.worlds.delete).toHaveBeenCalledWith('w1');
  });
});

// ---------------------------------------------------------------------------
// loadBibleMeta
// ---------------------------------------------------------------------------

describe('loadBibleMeta', () => {
  it('updates bibleTokenCount and bibleThreshold', async () => {
    mockApi.bible.getMeta.mockResolvedValue({ tokenCount: 1500, threshold: 50000 });
    await S().loadBibleMeta('w1');
    expect(S().bibleTokenCount).toBe(1500);
    expect(S().bibleThreshold).toBe(50000);
  });
});
