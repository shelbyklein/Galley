/**
 * Plain geometry for the canvas and the tools: points, rectangles and rotated boxes, in whatever space the caller
 * works in (page points, or view pixels). Pure; unit-tested through the modules that use it.
 */
import type { BoxFrame, Rect } from '@galley/model';
import type { Point } from './viewport';

export type { Point };

const DEG = Math.PI / 180;

/** Round to 4 decimals (0.0001 pt): gesture results are rounded so a snapped position is exact, not 36.00000000000001. */
export const round4 = (n: number): number => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
};

/** Normalize an angle in degrees to (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  else if (a <= -180) a += 360;
  return Object.is(a, -0) ? 0 : a;
}

/** Rotate `p` clockwise (screen convention: y points down) by `deg` about `center`. */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  if (deg === 0) return { x: p.x, y: p.y };
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** A rotated rectangle: center, size and clockwise rotation in degrees about the center. */
export interface OrientedBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export const frameBox = (f: Pick<BoxFrame, 'x' | 'y' | 'w' | 'h' | 'rotation'>): OrientedBox => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, w: f.w, h: f.h, rotation: f.rotation });

export const rectBox = (r: Rect): OrientedBox => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rotation: 0 });

/** The unrotated top-left and size of a box, as a frame stores it. */
export const boxFrameGeometry = (b: OrientedBox) => ({ x: round4(b.cx - b.w / 2), y: round4(b.cy - b.h / 2), w: round4(b.w), h: round4(b.h), rotation: round4(b.rotation) });

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const CORNER_HANDLES: readonly Handle[] = ['nw', 'ne', 'se', 'sw'];

/** Direction of a handle in the box's own axes: -1, 0 or 1 per axis. */
export const HANDLE_DIR: Record<Handle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

/** Where a handle of the box is, in the box's space (rotation applied). */
export function handlePoint(b: OrientedBox, handle: Handle): Point {
  const d = HANDLE_DIR[handle];
  return rotatePoint({ x: b.cx + (d.x * b.w) / 2, y: b.cy + (d.y * b.h) / 2 }, { x: b.cx, y: b.cy }, b.rotation);
}

/** A point expressed in the box's own axes, relative to its center (the inverse of rotating and translating the box). */
export function toLocal(b: OrientedBox, p: Point): Point {
  const q = rotatePoint(p, { x: b.cx, y: b.cy }, -b.rotation);
  return { x: q.x - b.cx, y: q.y - b.cy };
}

export function boxCorners(b: OrientedBox): Point[] {
  return (['nw', 'ne', 'se', 'sw'] as const).map((h) => handlePoint(b, h));
}

/** Axis-aligned bounds of a point set. */
export function boundsOfPoints(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle in degrees of the vector from `from` to `to`, clockwise from +x (y down). */
export const angleOf = (from: Point, to: Point): number => Math.atan2(to.y - from.y, to.x - from.x) / DEG;
