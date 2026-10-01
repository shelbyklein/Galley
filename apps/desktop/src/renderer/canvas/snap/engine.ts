/**
 * The snap engine (P1-11): pure functions, no DOM, no store (unit-tested in engine.test.ts).
 *
 * A drag proposes where something would land. The engine looks at the lines it could align with (the targets) and, per
 * axis, pulls the proposal onto the nearest one when it is within the threshold. The threshold is in screen pixels, so
 * callers pass `SNAP_PX / zoom` points: snapping feels the same at every zoom level.
 *
 * Targets, per page:
 *   guides       ruler guides
 *   margins      the four margin lines
 *   columns      the left and right edge of every column
 *   page edges   the trim edges, plus the page center on each axis
 *   bleed        the bleed edges (when the page has a bleed)
 *   objects      the edges and the center of every other frame on the page
 * Margin, column, bleed and guide targets follow the View > Guides toggle (`guides: false` leaves them out).
 */
import { boundsOf, getFrame, isBoxFrame, isLayerVisible, subtreeIds, type GalleyDocument, type Id, type Page, type Rect } from '@galley/model';
import type { Point } from '../geometry';
import type { SmartGuideLine } from '../canvasState';

/** Snap distance in screen pixels (InDesign's default is 4). */
export const SNAP_PX = 4;

export type SnapKind = 'guide' | 'margin' | 'column' | 'page-edge' | 'page-center' | 'bleed' | 'object-edge' | 'object-center';

export interface SnapTarget {
  axis: 'x' | 'y';
  /** Page points. */
  value: number;
  kind: SnapKind;
  /** For objects: the extent along the other axis, so the smart guide reaches the object it aligned with. */
  span?: readonly [number, number];
}

/** When two targets are equally near, the one earlier in this list wins: structure beats other objects. */
const PRIORITY: readonly SnapKind[] = ['guide', 'margin', 'column', 'page-edge', 'page-center', 'bleed', 'object-edge', 'object-center'];

// ---------------------------------------------------------------------------------------------------------- targets

export interface TargetOptions {
  /** Frames being dragged (and everything inside them): they are not targets for themselves. */
  exclude?: ReadonlySet<Id>;
  /** Include guides, margins, columns and bleed. Default true. */
  guides?: boolean;
  /** Include other objects. Default true. */
  objects?: boolean;
}

/** The page's structural targets: edges, center, margins, columns, bleed. */
export function pageTargets(page: Page, guides = true): SnapTarget[] {
  const out: SnapTarget[] = [
    { axis: 'x', value: 0, kind: 'page-edge' },
    { axis: 'x', value: page.width, kind: 'page-edge' },
    { axis: 'y', value: 0, kind: 'page-edge' },
    { axis: 'y', value: page.height, kind: 'page-edge' },
    { axis: 'x', value: page.width / 2, kind: 'page-center' },
    { axis: 'y', value: page.height / 2, kind: 'page-center' },
  ];
  if (!guides) return out;

  const m = page.margins;
  out.push(
    { axis: 'x', value: m.left, kind: 'margin' },
    { axis: 'x', value: page.width - m.right, kind: 'margin' },
    { axis: 'y', value: m.top, kind: 'margin' },
    { axis: 'y', value: page.height - m.bottom, kind: 'margin' },
  );

  const { count, gutter } = page.columns;
  if (count > 1) {
    const content = page.width - m.left - m.right;
    const colWidth = (content - gutter * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const left = m.left + i * (colWidth + gutter);
      out.push({ axis: 'x', value: left, kind: 'column' }, { axis: 'x', value: left + colWidth, kind: 'column' });
    }
  }

  const b = page.bleed;
  if (b.left > 0) out.push({ axis: 'x', value: -b.left, kind: 'bleed' });
  if (b.right > 0) out.push({ axis: 'x', value: page.width + b.right, kind: 'bleed' });
  if (b.top > 0) out.push({ axis: 'y', value: -b.top, kind: 'bleed' });
  if (b.bottom > 0) out.push({ axis: 'y', value: page.height + b.bottom, kind: 'bleed' });
  return out;
}

/** Every target on a page for a drag of the `exclude`d frames. */
export function collectSnapTargets(doc: GalleyDocument, pageId: Id, options: TargetOptions = {}): SnapTarget[] {
  const page = doc.pages[pageId];
  if (!page) return [];
  const { exclude = new Set<Id>(), guides = true, objects = true } = options;
  const out = pageTargets(page, guides);

  if (guides) {
    for (const g of Object.values(doc.guides)) {
      if (g.pageId === pageId) out.push({ axis: g.orientation === 'vertical' ? 'x' : 'y', value: g.position, kind: 'guide' });
    }
  }

  if (objects) {
    const excluded = new Set<Id>();
    for (const id of exclude) for (const sub of subtreeIds(doc, id)) excluded.add(sub);
    for (const id of page.items) addObjectTargets(doc, id, excluded, out);
  }
  return out;
}

function addObjectTargets(doc: GalleyDocument, id: Id, excluded: ReadonlySet<Id>, out: SnapTarget[]): void {
  if (excluded.has(id)) return;
  const f = getFrame(doc, id);
  if (f.type === 'group') {
    for (const c of f.childIds) addObjectTargets(doc, c, excluded, out);
    return;
  }
  if (!isBoxFrame(f) || !isLayerVisible(doc, f.layerId)) return;
  const b = boundsOf(doc, id);
  if (!b) return;
  const xs: readonly [number, number] = [b.x, b.x + b.w];
  const ys: readonly [number, number] = [b.y, b.y + b.h];
  out.push(
    { axis: 'x', value: b.x, kind: 'object-edge', span: ys },
    { axis: 'x', value: b.x + b.w, kind: 'object-edge', span: ys },
    { axis: 'x', value: b.x + b.w / 2, kind: 'object-center', span: ys },
    { axis: 'y', value: b.y, kind: 'object-edge', span: xs },
    { axis: 'y', value: b.y + b.h, kind: 'object-edge', span: xs },
    { axis: 'y', value: b.y + b.h / 2, kind: 'object-center', span: xs },
  );
}

// ------------------------------------------------------------------------------------------------------- snapping

/** How close (points) counts as "on" a target when listing which lines a result touches. */
const ON_TARGET = 1e-6;

interface AxisSnap {
  /** The amount to add to the proposal so it lands on the target; 0 when nothing is within the threshold. */
  delta: number;
  /** The targets the snapped proposal sits on (equal values merged: the first by priority is kept). */
  hits: SnapTarget[];
  snapped: boolean;
}

/** Snap one axis: pull the nearest of `candidates` onto the nearest target within `threshold`. */
export function snapAxis(candidates: readonly number[], targets: readonly SnapTarget[], threshold: number): AxisSnap {
  let best: SnapTarget | null = null;
  let bestDelta = 0;
  let bestDist = Infinity;
  for (const target of targets) {
    for (const c of candidates) {
      const d = target.value - c;
      const dist = Math.abs(d);
      if (dist > threshold) continue;
      if (dist < bestDist - ON_TARGET || (Math.abs(dist - bestDist) <= ON_TARGET && best && PRIORITY.indexOf(target.kind) < PRIORITY.indexOf(best.kind))) {
        best = target;
        bestDelta = d;
        bestDist = dist;
      }
    }
  }
  if (!best) return { delta: 0, hits: [], snapped: false };

  // every target the moved candidates now sit on, one per distinct value
  const byValue = new Map<number, SnapTarget[]>();
  for (const target of targets) {
    if (candidates.some((c) => Math.abs(c + bestDelta - target.value) <= ON_TARGET)) {
      const list = byValue.get(target.value) ?? [];
      list.push(target);
      byValue.set(target.value, list);
    }
  }
  return { delta: bestDelta, hits: [...byValue.values()].flat(), snapped: true };
}

export interface SnapResult {
  /** Adjustments to add to the proposal. */
  dx: number;
  dy: number;
  /** Smart guide lines to draw (page points). */
  lines: SmartGuideLine[];
  snappedX: boolean;
  snappedY: boolean;
}

/** Build the smart guide lines for the hits on one axis. `along` is the extent of the moved thing along the other axis. */
function linesFor(axis: 'x' | 'y', hits: readonly SnapTarget[], along: readonly [number, number]): SmartGuideLine[] {
  const byValue = new Map<number, SnapTarget[]>();
  for (const h of hits) byValue.set(h.value, [...(byValue.get(h.value) ?? []), h]);
  const out: SmartGuideLine[] = [];
  for (const [value, group] of byValue) {
    let from = along[0];
    let to = along[1];
    for (const h of group) {
      if (h.span) {
        from = Math.min(from, h.span[0]);
        to = Math.max(to, h.span[1]);
      }
    }
    const centered = group.some((h) => h.kind === 'page-center' || h.kind === 'object-center');
    const line: SmartGuideLine = { axis, value, from, to };
    if (centered) line.label = axis === 'x' ? 'center X' : 'center Y';
    out.push(line);
  }
  return out;
}

export interface SnapAxes {
  x?: boolean;
  y?: boolean;
}

/**
 * Snap a moving rectangle (page points): its left edge, center and right edge against the vertical targets, its top, middle
 * and bottom against the horizontal ones. `axes` limits which axes may snap (default both).
 */
export function snapRect(rect: Rect, targets: readonly SnapTarget[], threshold: number, axes: SnapAxes = {}): SnapResult {
  const { x: doX = true, y: doY = true } = axes;
  const xs = targets.filter((t) => t.axis === 'x');
  const ys = targets.filter((t) => t.axis === 'y');
  const sx = doX ? snapAxis([rect.x, rect.x + rect.w / 2, rect.x + rect.w], xs, threshold) : { delta: 0, hits: [] as SnapTarget[], snapped: false };
  const sy = doY ? snapAxis([rect.y, rect.y + rect.h / 2, rect.y + rect.h], ys, threshold) : { delta: 0, hits: [] as SnapTarget[], snapped: false };
  // the lines run along the snapped rectangle, so measure its extent after both adjustments
  const moved = { x: rect.x + sx.delta, y: rect.y + sy.delta };
  return {
    dx: sx.delta,
    dy: sy.delta,
    snappedX: sx.snapped,
    snappedY: sy.snapped,
    lines: [...linesFor('x', sx.hits, [moved.y, moved.y + rect.h]), ...linesFor('y', sy.hits, [moved.x, moved.x + rect.w])],
  };
}

/** Snap a single point (a drawing corner, a dragged resize edge). */
export function snapPoint(point: Point, targets: readonly SnapTarget[], threshold: number, axes: SnapAxes = {}): SnapResult {
  return snapRect({ x: point.x, y: point.y, w: 0, h: 0 }, targets, threshold, axes);
}
