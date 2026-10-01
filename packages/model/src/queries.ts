/**
 * Read-only helpers over a document. Pure functions of the document; safe to call from the renderer, the store's
 * selectors and the commands. None of them mutate.
 */
import type { Id } from './ids';
import type { Frame, GalleyDocument, Layer, Page, Insets } from './schema';
import { isBoxFrame } from './schema';
import type { Swatch } from './swatch';
import type { Story } from './text/story';

export class MissingObjectError extends Error {
  constructor(
    readonly kind: string,
    readonly id: Id,
  ) {
    super(`No ${kind} with id "${id}"`);
    this.name = 'MissingObjectError';
  }
}

export function getFrame(doc: GalleyDocument, id: Id): Frame {
  const f = doc.frames[id];
  if (!f) throw new MissingObjectError('frame', id);
  return f;
}
export function getPage(doc: GalleyDocument, id: Id): Page {
  const p = doc.pages[id];
  if (!p) throw new MissingObjectError('page', id);
  return p;
}
export function getLayer(doc: GalleyDocument, id: Id): Layer {
  const l = doc.layers[id];
  if (!l) throw new MissingObjectError('layer', id);
  return l;
}
export function getSwatch(doc: GalleyDocument, id: Id): Swatch {
  const s = doc.swatches[id];
  if (!s) throw new MissingObjectError('swatch', id);
  return s;
}
export function getStory(doc: GalleyDocument, id: Id): Story {
  const s = doc.stories[id];
  if (!s) throw new MissingObjectError('story', id);
  return s;
}

/** Pages in document order. */
export function pagesInOrder(doc: GalleyDocument): Page[] {
  return doc.pageOrder.map((id) => getPage(doc, id));
}

/** Layers bottom to top. (The Layers panel shows them reversed, topmost first.) */
export function layersInOrder(doc: GalleyDocument): Layer[] {
  return doc.layerOrder.map((id) => getLayer(doc, id));
}

/** Swatches in panel order. */
export function swatchesInOrder(doc: GalleyDocument): Swatch[] {
  return doc.swatchOrder.map((id) => getSwatch(doc, id));
}

// ---------------------------------------------------------------------------------------------------- containment

export interface DocIndex {
  /** The group a frame is in, or null for a top-level frame. */
  parentOf: ReadonlyMap<Id, Id | null>;
  /** The page a frame is on (for a group child, its top-level ancestor's page). */
  pageOf: ReadonlyMap<Id, Id>;
}

const indexCache = new WeakMap<GalleyDocument, DocIndex>();

/**
 * Parent and page lookups for every frame, built once per document object and cached. Because commands produce a new
 * document object per change (Immer structural sharing), the cache can never go stale.
 */
export function docIndex(doc: GalleyDocument): DocIndex {
  const cached = indexCache.get(doc);
  if (cached) return cached;
  const parentOf = new Map<Id, Id | null>();
  const pageOf = new Map<Id, Id>();
  const visit = (id: Id, parent: Id | null, pageId: Id) => {
    parentOf.set(id, parent);
    pageOf.set(id, pageId);
    const f = doc.frames[id];
    if (f?.type === 'group') for (const c of f.childIds) visit(c, id, pageId);
  };
  for (const pageId of doc.pageOrder) {
    const page = doc.pages[pageId];
    if (page) for (const id of page.items) visit(id, null, pageId);
  }
  const index: DocIndex = { parentOf, pageOf };
  indexCache.set(doc, index);
  return index;
}

export function parentOf(doc: GalleyDocument, id: Id): Id | null {
  return docIndex(doc).parentOf.get(id) ?? null;
}
export function pageIdOf(doc: GalleyDocument, id: Id): Id | undefined {
  return docIndex(doc).pageOf.get(id);
}

/** The frame and every frame below it in the group tree, parents before children. */
export function subtreeIds(doc: GalleyDocument, id: Id): Id[] {
  const out: Id[] = [];
  const visit = (fid: Id) => {
    out.push(fid);
    const f = doc.frames[fid];
    if (f?.type === 'group') f.childIds.forEach(visit);
  };
  visit(id);
  return out;
}

/** Ancestors from nearest to the top-level group. */
export function ancestorIds(doc: GalleyDocument, id: Id): Id[] {
  const out: Id[] = [];
  let p = parentOf(doc, id);
  while (p) {
    out.push(p);
    p = parentOf(doc, p);
  }
  return out;
}

/** The top-level ancestor (the frame itself when it is top-level): the thing that selecting this frame selects. */
export function topLevelAncestor(doc: GalleyDocument, id: Id): Id {
  const a = ancestorIds(doc, id);
  return a.length > 0 ? a[a.length - 1]! : id;
}

// -------------------------------------------------------------------------------------------------- paint order

/**
 * The top-level frames of a page in paint order, bottom to top: layer by layer (bottom layer first), and within a
 * layer in `items` order. Hidden layers are included; filter with `isLayerVisible`.
 */
export function pageFrameIds(doc: GalleyDocument, pageId: Id): Id[] {
  const page = getPage(doc, pageId);
  const rank = new Map(doc.layerOrder.map((id, i) => [id, i]));
  return page.items
    .map((id, i) => ({ id, i, layer: rank.get(getFrame(doc, id).layerId) ?? -1 }))
    .sort((a, b) => a.layer - b.layer || a.i - b.i)
    .map((e) => e.id);
}

/**
 * Every non-group frame on a page in paint order, with groups expanded in place. This is the order a renderer
 * draws and a hit test walks (in reverse).
 */
export function paintOrder(doc: GalleyDocument, pageId: Id): Exclude<Frame, { type: 'group' }>[] {
  const out: Exclude<Frame, { type: 'group' }>[] = [];
  const visit = (id: Id) => {
    const f = getFrame(doc, id);
    if (f.type === 'group') f.childIds.forEach(visit);
    else out.push(f);
  };
  pageFrameIds(doc, pageId).forEach(visit);
  return out;
}

export function isLayerVisible(doc: GalleyDocument, layerId: Id): boolean {
  return doc.layers[layerId]?.visible ?? false;
}
export function isLayerLocked(doc: GalleyDocument, layerId: Id): boolean {
  return doc.layers[layerId]?.locked ?? false;
}

// --------------------------------------------------------------------------------------------------------- geometry

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Center-based rotation of a box; returns the axis-aligned bounds of the rotated box. */
export function rotatedBounds(box: Rect, rotationDeg: number): Rect {
  const deg = ((rotationDeg % 360) + 360) % 360;
  // Quarter turns are exact (no sin/cos rounding), which matters for snapping to edges.
  if (deg === 0 || deg === 180) return { ...box };
  if (deg === 90 || deg === 270) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return { x: cx - box.h / 2, y: cy - box.w / 2, w: box.h, h: box.w };
  }
  const r = deg * (Math.PI / 180);
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const w = box.w * cos + box.h * sin;
  const h = box.w * sin + box.h * cos;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The frame's bounds in page coordinates, including rotation (axis-aligned). For a group, the union of its
 * children's bounds; null for a group with no children. A line's box is its length by its (zero) height; a stroke's
 * outer half-weight is not included.
 */
export function boundsOf(doc: GalleyDocument, id: Id): Rect | null {
  const f = getFrame(doc, id);
  if (isBoxFrame(f)) return rotatedBounds({ x: f.x, y: f.y, w: f.w, h: f.h }, f.rotation);
  let acc: Rect | null = null;
  for (const c of f.childIds) {
    const b = boundsOf(doc, c);
    if (b) acc = acc ? unionRect(acc, b) : b;
  }
  return acc;
}

/** The area of the printed sheet around the trim box: `max(bleed, slug)` on each side. */
export function sheetInsets(page: Page): Insets {
  return {
    top: Math.max(page.bleed.top, page.slug.top),
    right: Math.max(page.bleed.right, page.slug.right),
    bottom: Math.max(page.bleed.bottom, page.slug.bottom),
    left: Math.max(page.bleed.left, page.slug.left),
  };
}

/** The printed sheet size in points: trim plus `sheetInsets`. This is the page size handed to printToPDF. */
export function sheetSize(page: Page): { width: number; height: number } {
  const i = sheetInsets(page);
  return { width: page.width + i.left + i.right, height: page.height + i.top + i.bottom };
}
