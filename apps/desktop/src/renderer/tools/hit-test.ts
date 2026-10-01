/**
 * Hit testing the page in page points. A click selects the top-most frame under it; a marquee selects every frame it
 * touches. Pure (unit-tested in hit-test.test.ts).
 *
 * Which part of a frame counts as "on" it:
 *   - text and image frames: anywhere inside the box (an empty text frame is still selected by clicking in it)
 *   - rectangles and ellipses with a fill: the filled shape (and its stroke); with no fill: only the outline, like InDesign
 *   - lines: along the line
 * `tolerance` (points) widens the outline and line bands so thin things stay clickable at low zoom.
 */
import { boundsOf, getFrame, pageFrameIds, type BoxFrame, type Frame, type GalleyDocument, type Id, type Rect } from '@galley/model';
import { frameBox, rectsIntersect, toLocal, type Point } from '../canvas/geometry';
import { isSelectable } from './selection-model';

/** Is `p` (page points) on `frame`? */
export function hitFrame(frame: BoxFrame, p: Point, tolerance: number): boolean {
  const local = toLocal(frameBox(frame), p);
  const hw = frame.w / 2;
  const hh = frame.h / 2;
  const half = (frame.stroke?.weight ?? 0) / 2;
  const band = tolerance + half;

  if (frame.type === 'line') {
    // distance to the segment from (-hw, 0) to (hw, 0) in the line's own axes
    const dx = Math.max(Math.abs(local.x) - hw, 0);
    return Math.hypot(dx, local.y) <= band;
  }

  const filled = frame.type === 'text' || frame.type === 'image' || frame.fill !== null;
  if (frame.type === 'ellipse') {
    const rx = Math.max(hw, 1e-9);
    const ry = Math.max(hh, 1e-9);
    const r = Math.hypot(local.x / rx, local.y / ry);
    if (filled && r <= 1) return true;
    // outline band: the radial distance scaled back to points, a good approximation for ellipses that are not extreme
    return Math.abs(r - 1) * Math.min(rx, ry) <= band;
  }

  const insideX = Math.abs(local.x) <= hw;
  const insideY = Math.abs(local.y) <= hh;
  if (insideX && insideY) {
    if (filled) return true;
    return hw - Math.abs(local.x) <= band || hh - Math.abs(local.y) <= band;
  }
  // outside the box: within the band of the stroke
  return Math.abs(local.x) <= hw + band && Math.abs(local.y) <= hh + band;
}

function hitTree(doc: GalleyDocument, frame: Frame, p: Point, tolerance: number): boolean {
  if (frame.type === 'group') {
    for (let i = frame.childIds.length - 1; i >= 0; i--) {
      const child = getFrame(doc, frame.childIds[i]!);
      if (hitTree(doc, child, p, tolerance)) return true;
    }
    return false;
  }
  return hitFrame(frame, p, tolerance);
}

/** The top-most selectable top-level frame (or group) under `p`, or null. */
export function hitTest(doc: GalleyDocument, pageId: Id, p: Point, tolerance: number): Id | null {
  const ids = pageFrameIds(doc, pageId);
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]!;
    if (!isSelectable(doc, id)) continue;
    if (hitTree(doc, getFrame(doc, id), p, tolerance)) return id;
  }
  return null;
}

/** Selectable top-level frames whose bounds touch `rect` (page points), bottom to top. */
export function framesInRect(doc: GalleyDocument, pageId: Id, rect: Rect): Id[] {
  return pageFrameIds(doc, pageId).filter((id) => {
    if (!isSelectable(doc, id)) return false;
    const b = boundsOf(doc, id);
    return b !== null && rectsIntersect(b, rect);
  });
}
