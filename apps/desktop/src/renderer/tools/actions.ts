/**
 * Object actions on the selection: delete, group, ungroup, arrange, copy, cut, paste, duplicate, select all. Each is one
 * undo step. They take the store as a parameter so unit tests can run them on an isolated store; the commands in
 * canvas/commands.ts pass the app store.
 */
import { createId, groupFrames, parentOf, pageIdOf, removeFrames, reorderFrames, ungroupFrames, type GalleyDocument, type Id, type ReorderOp } from '@galley/model';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../store';
import { instantiateSnapshot, snapshotFrames, type Snapshot } from './clone';
import { normalizeSelection, selectableIds } from './selection-model';

type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

/** How far a paste or a duplicate lands from the original, points (each further paste steps again). */
export const PASTE_OFFSET = 12;

/** The layer new objects go on: the layer of the selection, else the top-most visible, unlocked layer. Null when none can take objects. */
export function targetLayerId(doc: GalleyDocument, selection: readonly Id[] = []): Id | null {
  const usable = (id: Id) => !!doc.layers[id] && doc.layers[id]!.visible && !doc.layers[id]!.locked;
  const first = selection.map((id) => doc.frames[id]?.layerId).find((l): l is Id => l !== undefined && usable(l));
  if (first) return first;
  for (let i = doc.layerOrder.length - 1; i >= 0; i--) if (usable(doc.layerOrder[i]!)) return doc.layerOrder[i]!;
  return null;
}

const selectionOf = (store: StoreLike): Id[] => {
  const s = store.getState();
  return normalizeSelection(s.history.doc, s.selection);
};

// ---------------------------------------------------------------------------------------------------------- delete

export function deleteSelection(store: StoreLike): boolean {
  const ids = selectionOf(store);
  if (ids.length === 0) return false;
  store.getState().dispatch(removeFrames, { ids });
  return true;
}

// ----------------------------------------------------------------------------------------------------------- group

/** Group needs two or more frames in the same container. */
export function canGroup(doc: GalleyDocument, ids: readonly Id[]): boolean {
  if (ids.length < 2) return false;
  const first = ids[0]!;
  return ids.every((id) => parentOf(doc, id) === parentOf(doc, first) && pageIdOf(doc, id) === pageIdOf(doc, first));
}

export function groupSelection(store: StoreLike): Id | null {
  const ids = selectionOf(store);
  if (!canGroup(store.getState().history.doc, ids)) return null;
  const groupId = createId('grp');
  store.getState().dispatch(groupFrames, { ids, groupId });
  store.getState().setSelection([groupId]);
  return groupId;
}

export function canUngroup(doc: GalleyDocument, ids: readonly Id[]): boolean {
  return ids.some((id) => doc.frames[id]?.type === 'group');
}

/** Ungroup the selected groups; the selection becomes their children (and any selected non-groups). */
export function ungroupSelection(store: StoreLike): boolean {
  const ids = selectionOf(store);
  const doc = store.getState().history.doc;
  const groups = ids.filter((id) => doc.frames[id]?.type === 'group');
  if (groups.length === 0) return false;
  const next: Id[] = [];
  for (const id of ids) {
    const f = doc.frames[id]!;
    if (f.type === 'group') next.push(...f.childIds);
    else next.push(id);
  }
  store.getState().dispatch(ungroupFrames, { ids: groups });
  store.getState().setSelection(next);
  return true;
}

// ---------------------------------------------------------------------------------------------------------- arrange

export function arrangeSelection(store: StoreLike, op: ReorderOp): boolean {
  const ids = selectionOf(store);
  if (ids.length === 0) return false;
  store.getState().dispatch(reorderFrames, { ids, op });
  return true;
}

// ----------------------------------------------------------------------------------------------------------- copy

/** The app clipboard: frames copied inside Galley (copy and paste of objects stays within the app). */
const clipboard: { snapshot: Snapshot | null; pastes: number } = { snapshot: null, pastes: 0 };

export const hasClipboard = (): boolean => clipboard.snapshot !== null;
export const clearClipboard = (): void => {
  clipboard.snapshot = null;
  clipboard.pastes = 0;
};

export function copySelection(store: StoreLike): boolean {
  const s = store.getState();
  const ids = normalizeSelection(s.history.doc, s.selection);
  const snap = snapshotFrames(s.history.doc, ids, s.currentPageId);
  if (!snap) return false;
  clipboard.snapshot = snap;
  clipboard.pastes = 0;
  return true;
}

export function cutSelection(store: StoreLike): boolean {
  if (!copySelection(store)) return false;
  return deleteSelection(store);
}

/**
 * Paste the app clipboard onto the current page, on top. `inPlace` puts the copies exactly where the originals were;
 * otherwise each paste steps by PASTE_OFFSET so copies do not hide each other (onto another page it is always in place).
 */
export function pasteClipboard(store: StoreLike, options: { inPlace?: boolean } = {}): Id[] {
  const snap = clipboard.snapshot;
  if (!snap) return [];
  const s = store.getState();
  const doc = s.history.doc;
  const pageId = s.currentPageId;
  const layer = targetLayerId(doc, s.selection) ?? doc.layerOrder[doc.layerOrder.length - 1]!;
  const stepped = !options.inPlace && snap.pageId === pageId;
  const offset = stepped ? PASTE_OFFSET * (clipboard.pastes + 1) : 0;
  const ids = instantiateSnapshot(store, snap, { pageId, dx: offset, dy: offset, fallbackLayerId: layer, transaction: 'Paste' });
  if (stepped) clipboard.pastes++;
  store.getState().setSelection(ids);
  return ids;
}

/** Duplicate the selection in one step, offset from the originals; the copies become the selection. */
export function duplicateSelection(store: StoreLike): Id[] {
  const s = store.getState();
  const doc = s.history.doc;
  const ids = normalizeSelection(doc, s.selection);
  const snap = snapshotFrames(doc, ids, s.currentPageId);
  if (!snap) return [];
  const layer = targetLayerId(doc, ids) ?? doc.layerOrder[doc.layerOrder.length - 1]!;
  const copies = instantiateSnapshot(store, snap, { pageId: s.currentPageId, dx: PASTE_OFFSET, dy: PASTE_OFFSET, fallbackLayerId: layer, transaction: 'Duplicate' });
  store.getState().setSelection(copies);
  return copies;
}

// ------------------------------------------------------------------------------------------------------ select all

export function selectAll(store: StoreLike): void {
  const s = store.getState();
  s.setSelection(selectableIds(s.history.doc, s.currentPageId));
}
