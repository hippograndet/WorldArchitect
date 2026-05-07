import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { worldSlice, type WorldSlice } from './worldSlice.ts';
import { articleSlice, type ArticleSlice } from './articleSlice.ts';
import { uiSlice, type UISlice } from './uiSlice.ts';
import { agentSlice, type AgentSlice } from './agentSlice.ts';
import { forgeSlice, type ForgeSlice } from './forgeSlice.ts';

export type StoreState = WorldSlice & ArticleSlice & UISlice & AgentSlice & ForgeSlice;

export const useStore = create<StoreState>()(
  immer((...a) => ({
    ...worldSlice(...a),
    ...articleSlice(...a),
    ...uiSlice(...a),
    ...agentSlice(...a),
    ...forgeSlice(...a),
  })),
);
