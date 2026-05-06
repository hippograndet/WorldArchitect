import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';
import type { World, CreateWorldInput } from '../types/world.ts';

export interface WorldSlice {
  worlds: World[];
  currentWorldId: string | null;
  bibleTokenCount: number;
  bibleThreshold: number;

  loadWorlds: () => Promise<void>;
  selectWorld: (id: string) => void;
  createWorld: (input: CreateWorldInput) => Promise<{ world: World; rootArticleId: string }>;
  updateWorld: (id: string, input: Partial<CreateWorldInput>) => Promise<void>;
  deleteWorld: (id: string) => Promise<void>;
  loadBibleMeta: (worldId: string) => Promise<void>;
}

export const worldSlice: StateCreator<StoreState, [['zustand/immer', never]], [], WorldSlice> = (set) => ({
  worlds: [],
  currentWorldId: null,
  bibleTokenCount: 0,
  bibleThreshold: 80000,

  loadWorlds: async () => {
    const worlds = await api.worlds.list();
    set((s) => { s.worlds = worlds; });
  },

  selectWorld: (id) => {
    set((s) => { s.currentWorldId = id; });
  },

  createWorld: async (input) => {
    const { world, rootArticleId } = await api.worlds.create(input);
    set((s) => {
      s.worlds.unshift(world);
      s.currentWorldId = world.id;
    });
    return { world, rootArticleId };
  },

  updateWorld: async (id, input) => {
    const updated = await api.worlds.update(id, input);
    set((s) => {
      const idx = s.worlds.findIndex((w) => w.id === id);
      if (idx >= 0) s.worlds[idx] = updated;
    });
  },

  deleteWorld: async (id) => {
    await api.worlds.delete(id);
    set((s) => {
      s.worlds = s.worlds.filter((w) => w.id !== id);
      if (s.currentWorldId === id) s.currentWorldId = null;
    });
  },

  loadBibleMeta: async (worldId) => {
    const result = await api.bible.getMeta(worldId);
    set((s) => {
      s.bibleTokenCount = result.tokenCount;
      s.bibleThreshold = result.threshold;
    });
  },
});
