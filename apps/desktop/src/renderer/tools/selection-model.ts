/**
 * What the selection tools see: which frames can be selected, the box a selection is drawn and transformed with, and the
 * leaf frames a gesture actually changes. Pure functions of the document (unit-tested in selection-model.test.ts).
 *
 * The selection holds top-level frame ids (a frame on the page, or a group): selecting a frame inside a group selects the
 * group, as with InDesign's Selection tool (going inside a group needs the Direct Selection tool, which is out of scope).
 */
import {
  boundsOf,
  getFrame,
  isBoxFrame,
  isLayerLocked,
  isLayerVisible,
  pageFrameIds,
  parentOf,
  subtreeIds,
  topLevelAncestor,
  unionRect,
  type BoxFrame,
  type GalleyDocument,
  type Id,
  type Rect,
} from '@galley/model';
import { frameBox, rectBox, type OrientedBox } from '../canvas/geometry';

/** A frame can be selected and transformed when its layer is visible and unlocked. */
export function isSelectable(doc: GalleyDocument, id: Id): boolean {
  const f = doc.frames[id];
  return !!f && isLayerVisible(doc, f.layerId) && !isLayerLocked(doc, f.layerId);
}

/** Top-level frames of a page that can be selected, bottom to top. */
export function selectableIds(doc: GalleyDocument, pageId: Id): Id[] {
  return pageFrameIds(doc, pageId).filter((id) => isSelectable(doc, id));
}

/** The selection reduced to ids that exist, are top-level, are not repeated, and are not inside another selected group. */
export function normalizeSelection(doc: GalleyDocument, ids: readonly Id[]): Id[] {
  const set = new Set(ids.filter((id) => id in doc.frames).map((id) => topLevelAncestor(doc, id)));
  return [...set];
}

/** Every non-group frame in the selection's trees, each once, parents' children in stacking order. */
export function leafFrames(doc: GalleyDocument, ids: readonly Id[]): BoxFrame[] {
  const seen = new Set<Id>();
  const out: BoxFrame[] = [];
  for (const id of ids) {
    for (const sub of subtreeIds(doc, id)) {
      if (seen.has(sub)) continue;
      seen.add(sub);
      const f = getFrame(doc, sub);
      if (isBoxFrame(f)) out.push(f);
    }
  }
  return out;
}

/** The union of the selection's axis-aligned bounds (rotation included), or null for an empty selection. */
export function selectionBounds(doc: GalleyDocument, ids: readonly Id[]): Rect | null {
  let acc: Rect | null = null;
  for (const id of ids) {
    const b = boundsOf(doc, id);
    if (b) acc = acc ? unionRect(acc, b) : b;
  }
  return acc;
}

export interface SelectionBox {
  /** The box the handles sit on: the frame's own rotated box for one frame, else the axis-aligned union bounds. */
  box: OrientedBox;
  /** One non-group frame: it keeps its rotation, and a rotation drag changes just its `rotation`. */
  single: BoxFrame | null;
  /** A line: only its two end handles resize it. */
  line: boolean;
}

export function selectionBox(doc: GalleyDocument, ids: readonly Id[]): SelectionBox | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const f = doc.frames[ids[0]!];
    if (f && isBoxFrame(f)) return { box: frameBox(f), single: f, line: f.type === 'line' };
  }
  const bounds = selectionBounds(doc, ids);
  return bounds ? { box: rectBox(bounds), single: null, line: false } : null;
}

/** True when `id` is `ancestor` or inside it. */
export function isWithin(doc: GalleyDocument, id: Id, ancestor: Id): boolean {
  let cur: Id | null = id;
  while (cur) {
    if (cur === ancestor) return true;
    cur = parentOf(doc, cur);
  }
  return false;
}
