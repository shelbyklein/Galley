// Geometry behind the control strip's X, Y, W, H and rotation fields. Pure functions of numbers, unit-tested.
//
// A frame is a box (x, y = top-left of its unrotated box, w, h) rotated by `rotation` degrees clockwise about its
// center. The reference point (the 3 x 3 proxy next to the fields) names a point on the box: (0, 0) top-left, (0.5, 0.5)
// center, (1, 1) bottom-right. The reference point rides on the *rotated* box, so it is always one of the selection
// handles. X and Y are where that point is; changing W, H or rotation keeps it where it is.
import { boundsOf, isBoxFrame, subtreeIds, type GalleyDocument, type Id, type Rect } from '@galley/model';

export interface RefPoint {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

export const REF_CENTER: RefPoint = { x: 0.5, y: 0.5 };
/** The default reference point, as in InDesign: X and Y read as the top-left corner. */
export const REF_TOP_LEFT: RefPoint = { x: 0, y: 0 };

export const REF_POINTS: readonly RefPoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 1, y: 0.5 },
  { x: 0, y: 1 },
  { x: 0.5, y: 1 },
  { x: 1, y: 1 },
];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the center. */
  rotation: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Remove float noise (1e-9 pt) without changing any value a person could have typed. */
export function clean(n: number): number {
  const r = Math.round(n * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

const isUnrotated = (rotation: number) => rotation % 360 === 0;

/** Rotate a vector clockwise on screen (y points down). */
function rotate(vx: number, vy: number, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
}

/** Where the reference point of a box is, in page coordinates. */
export function refPointOf(box: Box, ref: RefPoint): Point {
  if (isUnrotated(box.rotation)) return { x: clean(box.x + ref.x * box.w), y: clean(box.y + ref.y * box.h) };
  const o = rotate((ref.x - 0.5) * box.w, (ref.y - 0.5) * box.h, box.rotation);
  return { x: clean(box.x + box.w / 2 + o.x), y: clean(box.y + box.h / 2 + o.y) };
}

/**
 * The box after changing its size and/or rotation with the reference point held in place. `change` leaves out what
 * stays the same.
 */
export function resizeAboutRef(box: Box, ref: RefPoint, change: Partial<Pick<Box, 'w' | 'h' | 'rotation'>>): Box {
  const w = change.w ?? box.w;
  const h = change.h ?? box.h;
  const rotation = change.rotation ?? box.rotation;
  const p = refPointOf(box, ref);
  if (isUnrotated(rotation)) return { x: clean(p.x - ref.x * w), y: clean(p.y - ref.y * h), w, h, rotation };
  const o = rotate((ref.x - 0.5) * w, (ref.y - 0.5) * h, rotation);
  return { x: clean(p.x - o.x - w / 2), y: clean(p.y - o.y - h / 2), w, h, rotation };
}

/** The box moved so its reference point is at the given coordinates (either may be left out). */
export function moveRefTo(box: Box, ref: RefPoint, target: Partial<Point>): Box {
  const p = refPointOf(box, ref);
  const dx = target.x === undefined ? 0 : target.x - p.x;
  const dy = target.y === undefined ? 0 : target.y - p.y;
  if (isUnrotated(box.rotation)) {
    // exact for the common case: place the reference point, no round trip through the center
    return { ...box, x: target.x === undefined ? box.x : clean(target.x - ref.x * box.w), y: target.y === undefined ? box.y : clean(target.y - ref.y * box.h) };
  }
  return { ...box, x: clean(box.x + dx), y: clean(box.y + dy) };
}

export function refPointOfRect(rect: Rect, ref: RefPoint): Point {
  return { x: clean(rect.x + ref.x * rect.w), y: clean(rect.y + ref.y * rect.h) };
}

// ------------------------------------------------------------------------------------------------------- selection

/** What the control strip needs to know about the current selection. */
export interface SelectionGeometry {
  /** `box`: one frame with a box of its own. `bounds`: several frames, or a group, treated as one rectangle. */
  mode: 'box' | 'bounds';
  /** The box (mode `box`) or the union bounds with zero rotation (mode `bounds`). */
  box: Box;
  /** Every non-group frame the selection covers (a group expands to its leaves). */
  leafIds: Id[];
  /** Can W and H be edited? A mixed or rotated multi-selection cannot be scaled as a unit. */
  canResize: boolean;
  /** Can the rotation be edited? Only a single frame rotates. */
  canRotate: boolean;
}

/** The geometry of a selection, or null when nothing (or only things without a box) is selected. */
export function selectionGeometry(doc: GalleyDocument, ids: readonly Id[]): SelectionGeometry | null {
  const present = ids.filter((id) => doc.frames[id]);
  if (present.length === 0) return null;
  const first = doc.frames[present[0]!]!;
  if (present.length === 1 && isBoxFrame(first)) {
    return { mode: 'box', box: { x: first.x, y: first.y, w: first.w, h: first.h, rotation: first.rotation }, leafIds: [first.id], canResize: true, canRotate: true };
  }
  const leafIds: Id[] = [];
  const seen = new Set<Id>();
  for (const id of present) {
    for (const sub of subtreeIds(doc, id)) {
      if (seen.has(sub)) continue;
      seen.add(sub);
      if (isBoxFrame(doc.frames[sub]!)) leafIds.push(sub);
    }
  }
  let bounds: Rect | null = null;
  for (const id of present) {
    const b = boundsOf(doc, id);
    if (!b) continue;
    bounds = bounds ? { x: Math.min(bounds.x, b.x), y: Math.min(bounds.y, b.y), w: Math.max(bounds.x + bounds.w, b.x + b.w) - Math.min(bounds.x, b.x), h: Math.max(bounds.y + bounds.h, b.y + b.h) - Math.min(bounds.y, b.y) } : b;
  }
  if (!bounds || leafIds.length === 0) return null;
  const unrotated = leafIds.every((id) => isUnrotated((doc.frames[id] as { rotation: number }).rotation));
  return { mode: 'bounds', box: { ...bounds, rotation: 0 }, leafIds, canResize: unrotated, canRotate: false };
}

export interface LeafPatch {
  id: Id;
  props: { x: number; y: number; w: number; h: number };
}

/**
 * Scale every leaf frame of a multi-selection so the union bounds become `newW` x `newH`, holding the reference point.
 * Only valid when `canResize` (no rotated leaves).
 */
export function scaleLeaves(doc: GalleyDocument, geometry: SelectionGeometry, ref: RefPoint, newW: number, newH: number): LeafPatch[] {
  const b = geometry.box;
  const p = refPointOfRect(b, ref);
  const sx = b.w === 0 ? 1 : newW / b.w;
  const sy = b.h === 0 ? 1 : newH / b.h;
  return geometry.leafIds.map((id) => {
    const f = doc.frames[id] as { x: number; y: number; w: number; h: number };
    return { id, props: { x: clean(p.x + (f.x - p.x) * sx), y: clean(p.y + (f.y - p.y) * sy), w: clean(f.w * sx), h: clean(f.h * sy) } };
  });
}
