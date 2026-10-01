/**
 * Resize and rotate gestures on the selection handles, and the hit test that tells them apart.
 *
 * Handles sit on the selection's box: the frame's own rotated box for one frame, the axis-aligned union bounds for a group
 * or several frames. Eight square handles resize (a line has only its two ends); rotating starts just outside a corner.
 */
import { transformFrames, type Id, type Rect } from '@galley/model';
import { patchCanvasState } from '../../canvas/canvasState';
import {
  boxFrameGeometry,
  distance,
  handlePoint,
  HANDLE_DIR,
  HANDLES,
  CORNER_HANDLES,
  round4,
  toLocal,
  type Handle,
  type OrientedBox,
  type Point,
} from '../../canvas/geometry';
import { collectSnapTargets, snapPoint, type SnapTarget } from '../../canvas/snap/engine';
import { pageToView, type ViewTransform } from '../../canvas/viewport';
import { leafFrames, selectionBounds, selectionBox, type SelectionBox } from '../selection-model';
import { resizeBox, rotateGeometryAbout, rotationDelta, scaleFrameGeometry, type Geometry } from '../transform';
import { clearSmartGuides, DRAG_THRESHOLD, setSmartGuides, snapThreshold, type Gesture, type GestureContext, type PointerInfo } from './types';

/** How close to a handle's center a press resizes, CSS pixels. */
export const HANDLE_HIT_PX = 6;
/** How far outside a corner a press still rotates, CSS pixels. */
export const ROTATE_HIT_PX = 18;

export type HandleHit = { kind: 'resize'; handle: Handle } | { kind: 'rotate'; corner: Handle };

/** What a press at `viewPoint` (pasteboard pixels) grabs on the selection box: a handle, a rotate zone, or nothing. */
export function hitHandle(sb: SelectionBox, view: ViewTransform, viewPoint: Point): HandleHit | null {
  const c = pageToView(view, { x: sb.box.cx, y: sb.box.cy });
  const box: OrientedBox = { cx: c.x, cy: c.y, w: sb.box.w * view.zoom, h: sb.box.h * view.zoom, rotation: sb.box.rotation };
  const handles = sb.line ? (['e', 'w'] as Handle[]) : [...HANDLES];

  let best: { handle: Handle; d: number } | null = null;
  for (const h of handles) {
    const d = distance(handlePoint(box, h), viewPoint);
    if (d <= HANDLE_HIT_PX && (!best || d < best.d)) best = { handle: h, d };
  }
  if (best) return { kind: 'resize', handle: best.handle };

  // rotate: outside the box, near a corner (for a line, near an end)
  const local = toLocal(box, viewPoint);
  const outside = Math.abs(local.x) > box.w / 2 || Math.abs(local.y) > box.h / 2 || sb.line;
  if (!outside) return null;
  const corners: Handle[] = sb.line ? ['e', 'w'] : [...CORNER_HANDLES];
  let near: { corner: Handle; d: number } | null = null;
  for (const corner of corners) {
    const d = distance(handlePoint(box, corner), viewPoint);
    if (d <= ROTATE_HIT_PX && (!near || d < near.d)) near = { corner, d };
  }
  return near ? { kind: 'rotate', corner: near.corner } : null;
}

const startGeometry = (f: Geometry & { id: Id }) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation });

// ------------------------------------------------------------------------------------------------------------ resize

export class ResizeGesture implements Gesture {
  private started = false;
  private readonly sb: SelectionBox;
  private readonly leaves: ReturnType<typeof startGeometry>[];
  private readonly bounds: Rect;
  private readonly grab: Point;
  private targets: SnapTarget[] = [];
  private last = '';

  constructor(
    private readonly ctx: GestureContext,
    private readonly ids: Id[],
    private readonly handle: Handle,
    private readonly start: PointerInfo,
  ) {
    const doc = ctx.doc();
    this.sb = selectionBox(doc, ids)!;
    this.leaves = leafFrames(doc, ids).map(startGeometry);
    this.bounds = selectionBounds(doc, ids)!;
    // keep the offset between where the handle was grabbed and the handle's exact position, so the box does not jump
    const hp = handlePoint(this.sb.box, handle);
    this.grab = { x: start.page.x - hp.x, y: start.page.y - hp.y };
  }

  private begin(): void {
    const s = this.ctx.store.getState();
    s.beginTransaction('Resize');
    patchCanvasState({ gesture: 'resize' });
    this.targets = collectSnapTargets(this.ctx.doc(), this.ctx.pageId(), { exclude: new Set(this.ids), guides: s.view.guidesVisible });
    this.started = true;
  }

  move(p: PointerInfo): void {
    if (!this.started) {
      if (distance(p.view, this.start.view) < 1) return;
      this.begin();
    }
    const view = this.ctx.view();
    let pointer: Point = { x: p.page.x - this.grab.x, y: p.page.y - this.grab.y };

    // snap the dragged edge when the box is axis aligned (a rotated box's edges are not on the page axes)
    const axisAligned = this.sb.box.rotation === 0;
    if (axisAligned) {
      const dir = HANDLE_DIR[this.handle];
      const snap = snapPoint(pointer, this.targets, snapThreshold(view), { x: dir.x !== 0, y: dir.y !== 0 });
      pointer = { x: pointer.x + snap.dx, y: pointer.y + snap.dy };
      setSmartGuides(snap.lines);
    }

    const box = resizeBox(this.sb.box, this.handle, pointer, { shift: p.shift, alt: p.alt, lockHeight: this.sb.line });
    let changes;
    if (this.sb.single) {
      changes = [{ id: this.sb.single.id, ...boxFrameGeometry(box) }];
    } else {
      const to: Rect = { x: box.cx - box.w / 2, y: box.cy - box.h / 2, w: box.w, h: box.h };
      changes = this.leaves.map((l) => {
        const g = scaleFrameGeometry(l, this.bounds, to);
        return { id: l.id, x: round4(g.x), y: round4(g.y), w: round4(g.w), h: round4(g.h) };
      });
    }
    const key = JSON.stringify(changes);
    if (key === this.last) return;
    this.last = key;
    this.ctx.store.getState().dispatch(transformFrames, { changes });
  }

  up(): void {
    clearSmartGuides();
    if (!this.started) return;
    this.ctx.store.getState().commitTransaction();
    patchCanvasState({ gesture: null });
  }

  cancel(): void {
    clearSmartGuides();
    if (!this.started) return;
    this.ctx.store.getState().cancelTransaction();
    patchCanvasState({ gesture: null });
  }
}

// ----------------------------------------------------------------------------------------------------------- rotate

export class RotateGesture implements Gesture {
  private started = false;
  private readonly sb: SelectionBox;
  private readonly leaves: ReturnType<typeof startGeometry>[];
  private readonly pivot: Point;
  private last = '';

  constructor(
    private readonly ctx: GestureContext,
    private readonly ids: Id[],
    private readonly start: PointerInfo,
  ) {
    const doc = ctx.doc();
    this.sb = selectionBox(doc, ids)!;
    this.leaves = leafFrames(doc, ids).map(startGeometry);
    this.pivot = { x: this.sb.box.cx, y: this.sb.box.cy };
  }

  move(p: PointerInfo): void {
    if (!this.started) {
      if (distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
      this.ctx.store.getState().beginTransaction('Rotate');
      patchCanvasState({ gesture: 'rotate' });
      this.started = true;
    }
    const delta = rotationDelta(this.pivot, this.start.page, p.page, { shift: p.shift, baseRotation: this.sb.single ? this.sb.single.rotation : 0 });
    const changes = this.leaves.map((l) => {
      const g = rotateGeometryAbout(l, this.pivot, delta);
      return { id: l.id, x: round4(g.x), y: round4(g.y), rotation: round4(g.rotation) };
    });
    const key = JSON.stringify(changes);
    if (key === this.last) return;
    this.last = key;
    this.ctx.store.getState().dispatch(transformFrames, { changes });
  }

  up(): void {
    if (!this.started) return;
    this.ctx.store.getState().commitTransaction();
    patchCanvasState({ gesture: null });
  }

  cancel(): void {
    if (!this.started) return;
    this.ctx.store.getState().cancelTransaction();
    patchCanvasState({ gesture: null });
  }
}
