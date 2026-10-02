import type { PMMark } from '@galley/model';
import { create } from 'zustand';
export interface CaretFormatting { storyId: string; position: number; marks: PMMark[]; }
export const useTypeStore = create<{ mode: 'character' | 'paragraph'; caret: CaretFormatting | null; setMode(mode: 'character' | 'paragraph'): void; setCaret(caret: CaretFormatting | null): void }>((set) => ({ mode: 'character', caret: null, setMode: (mode) => set({ mode }), setCaret: (caret) => set({ caret }) }));
