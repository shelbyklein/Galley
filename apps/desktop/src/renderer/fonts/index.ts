import { useSyncExternalStore } from 'react';
export type { FontFamilyInfo, FontFaceInfo } from '@galley/fonts/types';
import type { FontFamilyInfo } from '@galley/fonts/types';
let families: readonly FontFamilyInfo[] = [];
const listeners = new Set<() => void>();
/** Every scanned system/document family, with bundled Inter retained, sorted by family name. */
export function getFontFamilies(): readonly FontFamilyInfo[] { return families; }
export function useFontFamilies(): readonly FontFamilyInfo[] { return useSyncExternalStore(subscribe, getFontFamilies, getFontFamilies); }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function refreshFontFamilies(): Promise<void> {
  if (!window.galley?.fonts) return;
  const next = await window.galley.fonts.families();
  if (JSON.stringify(next) !== JSON.stringify(families)) { families = next; for (const listener of listeners) listener(); }
}
