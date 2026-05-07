import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import type { VisualTheme } from '../types/world.ts';

export type ActiveView = 'encyclopedia' | 'timeline' | 'bible' | 'usage';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'neutral';
  onConfirm: () => void | Promise<void>;
}

export interface UISlice {
  toasts: Toast[];
  confirmDialog: ConfirmDialogState | null;
  sidebarOpen: boolean;
  activeView: ActiveView;
  searchQuery: string;
  globalTheme: VisualTheme;
  fontSize: number;

  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  showConfirm: (state: ConfirmDialogState) => void;
  dismissConfirm: () => void;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (q: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setGlobalTheme: (theme: VisualTheme) => void;
  setFontSize: (size: number) => void;
}

let toastSeq = 0;

export const uiSlice: StateCreator<StoreState, [['zustand/immer', never]], [], UISlice> = (set) => ({
  toasts: [],
  confirmDialog: null,
  sidebarOpen: true,
  activeView: 'encyclopedia',
  searchQuery: '',
  globalTheme: (localStorage.getItem('wa-theme') as VisualTheme) || 'default',
  fontSize: Number(localStorage.getItem('wa-font-scale')) || 1,

  addToast: (toast) => {
    const id = String(++toastSeq);
    set((s) => { s.toasts.push({ ...toast, id }); });
    setTimeout(() => set((s) => { s.toasts = s.toasts.filter((t) => t.id !== id); }), 4000);
  },

  dismissToast: (id) => {
    set((s) => { s.toasts = s.toasts.filter((t) => t.id !== id); });
  },

  showConfirm: (dialog) => {
    set((s) => { s.confirmDialog = dialog; });
  },

  dismissConfirm: () => {
    set((s) => { s.confirmDialog = null; });
  },

  setActiveView: (view) => {
    set((s) => { s.activeView = view; });
  },

  setSearchQuery: (q) => {
    set((s) => { s.searchQuery = q; });
  },

  setSidebarOpen: (open) => {
    set((s) => { s.sidebarOpen = open; });
  },

  setGlobalTheme: (theme) => {
    localStorage.setItem('wa-theme', theme);
    set((s) => { s.globalTheme = theme; });
  },

  setFontSize: (size) => {
    localStorage.setItem('wa-font-scale', String(size));
    set((s) => { s.fontSize = size; });
  },
});
