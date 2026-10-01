/**
 * Resize and rotate math for the selection gestures, pure (unit-tested in transform.test.ts). Everything is in page points
 * and degrees; results are not rounded here (callers round with `round4` when they write to the model).
 */
import type { BoxFrame, Rect } from '@galley/model';
import {
  frameBox,
  HANDLE_DIR,
  normalizeAngle,
  rotatePoint,
  toLocal,
  angleOf,
  type Handle,
  type OrientedBox,
  type Point,
} from '../canvas/geometry';

export interface ResizeOptions {
  /** Keep proportions. */
  shift?: boolean;
  /** Resize from the center instead of from the opposite edge or corner. */
  alt?: boolean;
  /** Smallest width/height a resize can reach, points. Default 1. */
  minSize?: number;
  /** A line: its height stays exactly 0 and only its length changes. */
  lockHeight?: boolean;
}

/**
 * Drag `handle` of `start` to `pointer` (page points). The opposite edge (or the center, with alt) stays where it is;
 * with shift the box keeps its aspect ratio. The box keeps its rotation; the pointer is read in the box's own axes, so a
 * rotated box resizes along its own edges.
 */
export function resizeBox(start: OrientedBox, handle: Handle, pointer: Point, options: ResizeOptions = {}): OrientedBox {
  const { shift = false, alt = false, minSize = 1, lockHeight = false } = options;
  const dir = HANDLE_DIR[handle];
  const local = toLocal(start, pointer);

  // size along one axis if the dragged edge follows the pointer
  const axisSize = (d: number, size: number, p: number): number => {
    if (d === 0) return size;
    return Math.max(minSize, alt ? 2 * p * d : p * d + size / 2);
  };
  let w = axisSize(dir.x, start.w, local.x);
  let h = lockHeight ? 0 : axisSize(dir.y, start.h, local.y);

  if (shift && !lockHeight && start.w > 0 && start.h > 0) {
    if (dir.x !== 0 && dir.y !== 0) {
      const s = Math.max(w / start.w, h / start.h);
      w = Math.max(minSize, start.w * s);
      h = Math.max(minSize, start.h * s);
    } else if (dir.x !== 0) {
      h = Math.max(minSize, start.h * (w / start.w));
    } else {
      w = Math.max(minSize, start.w * (h / start.h));
    }
  }

  // the new center, in the box's own axes relative to the old center: the opposite edge is the anchor
  const centerOffset = (d: number, oldSize: number, newSize: number): number => (alt || d === 0 ? 0 : -d * (oldSize / 2) + (d * newSize) / 2);
  const lx = centerOffset(dir.x, start.w, w);
  const ly = lockHeight ? 0 : centerOffset(dir.y, start.h, h);
  const center = rotatePoint({ x: start.cx + lx, y: start.cy + ly }, { x: start.cx, y: start.cy }, start.rotation);
  return { cx: center.x, cy: center.y, w, h, rotation: start.rotation };
}

/** A frame's geometry as the model stores it. */
export type Geometry = Pick<BoxFrame, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

/**
 * Map a frame from inside rectangle `from` to the same place inside `to`: how a group (or a multi-selection) resizes its
 * frames. Positions scale about the rectangle; a frame's own size scales by x/y when it is turned a quarter turn
 * (swapped), and by the geometric mean at other angles, since a non-uniform scale cannot be expressed by a rotated box.
 * Rotation is unchanged.
 */
export function scaleFrameGeometry(frame: Geometry, from: Rect, to: Rect): Geometry {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const cx = to.x + (frame.x + frame.w / 2 - from.x) * sx;
  const cy = to.y + (frame.y + frame.h / 2 - from.y) * sy;
  const turn = ((Math.abs(frame.rotation) % 180) + 180) % 180;
  let fx: number;
  let fy: number;
  if (turn < 1e-9 || Math.abs(turn - 180) < 1e-9) [fx, fy] = [sx, sy];
  else if (Math.abs(turn - 90) < 1e-9) [fx, fy] = [sy, sx];
  else fx = fy = Math.sqrt(sx * sy);
  const w = frame.w * fx;
  const h = frame.h * fy;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation: frame.rotation };
}

/** The box a frame occupies: kept in one place so gestures and the overlay agree. */
export const geometryBox = (g: Geometry): OrientedBox => frameBox(g);

/**
 * Rotate a frame by `delta` degrees about `pivot`: its center moves around the pivot and its own rotation grows by
 * `delta`. About its own center this just changes `rotation`.
 */
export function rotateGeometryAbout(frame: Geometry, pivot: Point, delta: number): Geometry {
  const c = rotatePoint({ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }, pivot, delta);
  return { x: c.x - frame.w / 2, y: c.y - frame.h / 2, w: frame.w, h: frame.h, rotation: normalizeAngle(frame.rotation + delta) };
}

/**
 * The rotation to apply for a drag: the angle swept around `pivot` from `start` to `pointer`. With shift, the result
 * snaps so that the total rotation (`baseRotation + delta`) is a multiple of 45 degrees (for a group the base is 0, so the
 * turn itself snaps).
 */
export function rotationDelta(pivot: Point, start: Point, pointer: Point, options: { shift?: boolean; baseRotation?: number } = {}): number {
  let delta = angleOf(pivot, pointer) - angleOf(pivot, start);
  const base = options.baseRotation ?? 0;
  if (options.shift) delta = Math.round((base + delta) / 45) * 45 - base;
  return delta;
}
