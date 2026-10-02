/**
 * Copying frames: the snapshot a copy takes, and instantiating a snapshot as new frames (paste, duplicate, alt-drag).
 *
 * A snapshot holds whole frame trees (a group with its children) plus the stories of text frames, by value, so it
 * survives later edits and deletes of the originals. Instantiating gives every frame and story a fresh id, adds the leaf
 * frames with `frame.add`, then re-forms each group with `frame.group` from the inside out.
 */
import { addFrame, createId, groupFrames, pageFrameIds, subtreeIds, type Frame, type GalleyDocument, type Id, type Story } from '@galley/model';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../store';

export interface Snapshot {
  /** Every frame of the copied trees, parents before children. */
  frames: Frame[];
  /** The copied top-level frames, bottom to top. */
  roots: Id[];
  stories: Story[];
  /** The page they were copied from. */
  pageId: Id;
}

/** Copy the frames with `ids` (top-level frames or groups on one page). Null when there is nothing to copy. */
export function snapshotFrames(doc: GalleyDocument, ids: readonly Id[], pageId: Id): Snapshot | null {
  const wanted = new Set(ids);
  const roots = pageFrameIds(doc, pageId).filter((id) => wanted.has(id));
  if (roots.length === 0) return null;
  const frames: Frame[] = [];
  const stories: Story[] = [];
  for (const root of roots) {
    for (const id of subtreeIds(doc, root)) {
      const f = doc.frames[id]!;
      frames.push(structuredClone(f));
      if (f.type === 'text') {
        const story = doc.stories[f.storyId];
        if (story) stories.push(structuredClone(story));
      }
    }
  }
  return { frames, roots, stories, pageId };
}

export interface InstantiateOptions {
  /** The page to add to. */
  pageId: Id;
  /** Shift every copied frame by this much, points. */
  dx?: number;
  dy?: number;
  /** Used for frames whose layer no longer exists. */
  fallbackLayerId: Id;
  /** Open (and commit) one undo step with this label. Omit when the caller already has a transaction open. */
  transaction?: string;
  makeId?: (prefix: string) => Id;
}

type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

/** Add copies of a snapshot to a page. Returns the ids of the new top-level frames, in the snapshot's order. */
export function instantiateSnapshot(store: StoreLike, snap: Snapshot, options: InstantiateOptions): Id[] {
  const { pageId, dx = 0, dy = 0, fallbackLayerId, transaction, makeId = createId } = options;
  const state = store.getState();
  const doc = state.history.doc;
  const ids = new Map<Id, Id>();
  for (const f of snap.frames) ids.set(f.id, makeId(f.type === 'group' ? 'grp' : 'frm'));
  const storyIds = new Map<Id, Id>();
  for (const s of snap.stories) storyIds.set(s.id, makeId('story'));
  const storyById = new Map(snap.stories.map((s) => [s.id, s]));

  if (transaction) state.beginTransaction(transaction);
  try {
    for (const f of snap.frames) {
      if (f.type === 'group') continue;
      const copy = structuredClone(f);
      copy.id = ids.get(f.id)!;
      copy.layerId = doc.layers[f.layerId] ? f.layerId : fallbackLayerId;
      copy.x += dx;
      copy.y += dy;
      if (copy.fill && !doc.swatches[copy.fill.swatchId]) copy.fill = null;
      if (copy.stroke && !doc.swatches[copy.stroke.paint.swatchId]) copy.stroke = null;
      let story: Story | undefined;
      if (copy.type === 'text') {
        const source = storyById.get(f.type === 'text' ? f.storyId : '');
        if (!source) continue; // a text frame without its story cannot exist
        story = { ...structuredClone(source), id: storyIds.get(source.id)! };
        copy.storyId = story.id;
      } else if (copy.type === 'image' && copy.assetId !== null && !doc.assets[copy.assetId]) {
        copy.assetId = null;
        copy.content = null;
      }
      store.getState().dispatch(addFrame, { frame: copy, pageId, story });
    }
    // groups from the inside out: a child group is one page-level frame again before its parent groups it
    for (const f of [...snap.frames].reverse()) {
      if (f.type !== 'group') continue;
      const children = f.childIds.map((c) => ids.get(c)!).filter((c) => store.getState().history.doc.frames[c]);
      if (children.length === 0) continue;
      store.getState().dispatch(groupFrames, { ids: children, groupId: ids.get(f.id)!, name: f.name });
    }
    if (transaction) store.getState().commitTransaction();
  } catch (error) {
    if (transaction) store.getState().cancelTransaction();
    throw error;
  }
  return snap.roots.map((r) => ids.get(r)!).filter((id) => store.getState().history.doc.frames[id]);
}
