import { original } from 'immer';
import type { Id } from '../ids';
import { parentOf, pageIdOf, subtreeIds } from '../queries';
import type { Frame, GalleyDocument, Layer, Page } from '../schema';
import type { Swatch } from '../swatch';
import type { Story } from '../text/story';
import type { Asset } from '../schema';
import { fail, type DocDraft } from './types';
import type { Draft } from 'immer';

/** Deep copy for data that comes from command arguments before it is stored in the document (Immer freezes what it stores). */
export function own<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The document as it was when the command started. Use it for read-only queries (`parentOf`, `subtreeIds`, ...) that
 * need the cached index; write through the draft. Only valid until the command's first mutation matters: read what
 * you need first, then mutate.
 */
export function baseOf(d: DocDraft): GalleyDocument {
  const base = original(d);
  if (!base) throw new Error('baseOf: not an Immer draft');
  return base as GalleyDocument;
}

export function frameOf(d: DocDraft, id: Id): Draft<Frame> {
  return d.frames[id] ?? fail(`No frame "${id}"`);
}
export function pageOf(d: DocDraft, id: Id): Draft<Page> {
  return d.pages[id] ?? fail(`No page "${id}"`);
}
export function layerOf(d: DocDraft, id: Id): Draft<Layer> {
  return d.layers[id] ?? fail(`No layer "${id}"`);
}
export function swatchOf(d: DocDraft, id: Id): Draft<Swatch> {
  return d.swatches[id] ?? fail(`No swatch "${id}"`);
}
export function storyOf(d: DocDraft, id: Id): Draft<Story> {
  return d.stories[id] ?? fail(`No story "${id}"`);
}
export function assetOf(d: DocDraft, id: Id): Draft<Asset> {
  return d.assets[id] ?? fail(`No asset "${id}"`);
}

export function assertFinite(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} must be a finite number of points, got ${String(value)}`);
}

/** Insert `id` into `list` at `index` (default: the end). */
export function insertAt(list: Id[], id: Id, index: number | undefined): void {
  const at = index ?? list.length;
  if (!Number.isInteger(at) || at < 0 || at > list.length) fail(`Index ${String(index)} is out of range 0..${list.length}`);
  list.splice(at, 0, id);
}

/** Remove `id` from `list`; fails when it is not there. */
export function removeFrom(list: Id[], id: Id): void {
  const i = list.indexOf(id);
  if (i < 0) fail(`"${id}" is not in the list`);
  list.splice(i, 1);
}

/** The draft list that holds a frame: its group's `childIds`, or its page's `items`. Uses the starting document's index. */
export function containerOf(d: DocDraft, base: GalleyDocument, id: Id): Id[] {
  const parent = parentOf(base, id);
  if (parent) {
    const g = d.frames[parent];
    if (g?.type !== 'group') fail(`Frame "${parent}" is not a group`);
    return g.childIds;
  }
  const pageId = pageIdOf(base, id);
  if (!pageId) fail(`Frame "${id}" is not on any page`);
  return pageOf(d, pageId).items;
}

/**
 * Delete frames and everything inside them: their stories, their entries in page `items` and group `childIds`, and any
 * group left empty. Shared by `frame.remove`, `page.remove` and `layer.remove`.
 */
export function deleteFrameTrees(d: DocDraft, ids: readonly Id[]): void {
  const base = baseOf(d);
  for (const id of ids) frameOf(d, id);
  const doomed = new Set<Id>();
  for (const id of ids) for (const sub of subtreeIds(base, id)) doomed.add(sub);

  const survivingParents = new Set<Id>();
  for (const id of doomed) {
    const parent = parentOf(base, id);
    if (parent && doomed.has(parent)) continue; // goes away with its group
    if (parent) survivingParents.add(parent);
    removeFrom(containerOf(d, base, id), id);
  }
  for (const id of doomed) {
    const f = base.frames[id]!;
    if (f.type === 'text') delete d.stories[f.storyId];
    delete d.frames[id];
  }

  // a group whose last child was deleted is deleted too, up the tree
  let queue = [...survivingParents];
  while (queue.length > 0) {
    const next = new Set<Id>();
    for (const gid of queue) {
      const g = d.frames[gid];
      if (g?.type !== 'group' || g.childIds.length > 0) continue;
      const parent = parentOf(base, gid);
      removeFrom(containerOf(d, base, gid), gid);
      delete d.frames[gid];
      if (parent) next.add(parent);
    }
    queue = [...next];
  }
}
