/**
 * The Selection tool: what a pointer press does and the gestures it starts (move, marquee).
 *
 * Press order: a handle of the current selection (resize, or rotate just outside a corner), then a ruler guide, then the
 * object under the pointer (select it and drag), else a marquee on the empty pasteboard.
 */
import { transformFrames, type Id, type Rect } from '@galley/model';
import { patchCanvasState } from '../../canvas/canvasState';
import { distance, normalizeRect, round4 } from '../../canvas/geometry';
import { collectSnapTargets, snapRect, type SnapTarget } from '../../canvas/snap/engine';
import { instantiateSnapshot, snapshotFrames } from '../clone';
import { targetLayerId } from '../actions';
import { hitTest, framesInRect } from '../hit-test';
import { leafFrames, normalizeSelection, selectionBounds, selectionBox } from '../selection-model';
import { hitGuide, GuideMoveGesture } from './guides';
import { hitHandle, ResizeGesture, RotateGesture } from './transform';
import { clearSmartGuides, DRAG_THRESHOLD, HIT_PX, setSmartGuides, snapThreshold, type Gesture, type GestureContext, type PointerInfo } from './types';

/** The ids a click on `hit` leaves selected, and what to do when the press turns out to be a plain click (no drag). */
function pressSelection(selection: Id[], hit: Id, shift: boolean): { ids: Id[]; onClick: ((ctx: GestureContext) => void) | null } {
  const selected = selection.includes(hit);
  if (shift) {
    // shift-click adds an unselected object at once; it removes a selected one only if the press was not a drag
    if (!selected) return { ids: [...selection, hit], onClick: null };
    return { ids: selection, onClick: (ctx) => ctx.store.getState().setSelection(selection.filter((id) => id !== hit)) };
  }
  if (!selected) return { ids: [hit], onClick: null };
  // pressing one of several selected objects selects just it, unless the press becomes a drag of them all
  return { ids: selection, onClick: selection.length > 1 ? (ctx) => ctx.store.getState().setSelection([hit]) : null };
}

/** Pointer down with the Selection tool. Returns the gesture that follows, or null when the press needs none. */
export function beginSelectGesture(ctx: GestureContext, p: PointerInfo): Gesture | null {
  const store = ctx.store.getState();
  const doc = ctx.doc();
  const view = ctx.view();
  const selection = normalizeSelection(doc, store.selection);

  const sb = selectionBox(doc, selection);
  if (sb) {
    const hit = hitHandle(sb, view, p.view);
    if (hit?.kind === 'resize') return new ResizeGesture(ctx, selection, hit.handle, p);
    if (hit?.kind === 'rotate') return new RotateGesture(ctx, selection, p);
  }

  if (store.view.guidesVisible) {
    const guide = hitGuide(doc, ctx.pageId(), view, p.view);
    if (guide) return new GuideMoveGesture(ctx, guide, p);
  }

  const hit = hitTest(doc, ctx.pageId(), p.page, HIT_PX / view.zoom);
  if (hit) {
    const press = pressSelection(selection, hit, p.shift);
    if (press.ids !== selection) store.setSelection(press.ids);
    return new MoveGesture(ctx, p, press.ids, press.onClick);
  }
  return new MarqueeGesture(ctx, p, selection);
}

// ------------------------------------------------------------------------------------------------------------ marquee

export class MarqueeGesture implements Gesture {
  private dragging = false;

  constructor(
    private readonly ctx: GestureContext,
    private readonly start: PointerInfo,
    private readonly before: Id[],
  ) {}

  move(p: PointerInfo): void {
    if (!this.dragging && distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
    this.dragging = true;
    patchCanvasState({ marquee: { rect: normalizeRect(this.start.view, p.view), kind: 'select' } });
    const page: Rect = normalizeRect(this.start.page, p.page);
    const inside = framesInRect(this.ctx.doc(), this.ctx.pageId(), page);
    // shift adds the marquee's objects to the selection that was there before
    this.ctx.store.getState().setSelection(p.shift ? [...new Set([...this.before, ...inside])] : inside);
  }

  up(p: PointerInfo): void {
    patchCanvasState({ marquee: null });
    if (!this.dragging && !p.shift) this.ctx.store.getState().clearSelection(); // a click on empty pasteboard
  }

  cancel(): void {
    patchCanvasState({ marquee: null });
    this.ctx.store.getState().setSelection(this.before);
  }
}

// -------------------------------------------------------------------------------------------------------------- move

interface Leaf {
  id: Id;
  x: number;
  y: number;
}

/**
 * Dragging the selection. Nothing changes until the pointer has moved DRAG_THRESHOLD pixels; then one transaction opens and
 * every pointer move sets each frame to its start position plus the drag (absolute values, so a snapped position is exact).
 * Alt at that moment drags copies instead. Shift locks the drag to the dominant axis.
 */
export class MoveGesture implements Gesture {
  private started = false;
  private ids: Id[];
  private readonly originalIds: Id[];
  private leaves: Leaf[] = [];
  private startBounds: Rect | null = null;
  private targets: SnapTarget[] = [];
  private last = '';

  constructor(
    private readonly ctx: GestureContext,
    private readonly start: PointerInfo,
    ids: Id[],
    private readonly onClick: ((ctx: GestureContext) => void) | null,
  ) {
    this.ids = ids;
    this.originalIds = ids;
  }

  private begin(p: PointerInfo): void {
    const store = this.ctx.store.getState();
    const duplicate = p.alt;
    store.beginTransaction(duplicate ? 'Duplicate' : 'Move');
    patchCanvasState({ gesture: 'move' });
    if (duplicate) {
      const doc = this.ctx.doc();
      const snap = snapshotFrames(doc, this.ids, this.ctx.pageId());
      if (snap) {
        const layer = targetLayerId(doc, this.ids) ?? doc.layerOrder[doc.layerOrder.length - 1]!;
        this.ids = instantiateSnapshot(this.ctx.store, snap, { pageId: this.ctx.pageId(), fallbackLayerId: layer });
        store.setSelection(this.ids);
      }
    }
    const doc = this.ctx.doc();
    this.leaves = leafFrames(doc, this.ids).map((f) => ({ id: f.id, x: f.x, y: f.y }));
    this.startBounds = selectionBounds(doc, this.ids);
    this.targets = collectSnapTargets(doc, this.ctx.pageId(), { exclude: new Set(this.ids), guides: store.view.guidesVisible });
    this.started = true;
  }

  move(p: PointerInfo): void {
    if (!this.started) {
      if (distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
      this.begin(p);
    }
    if (!this.startBounds) return;
    const view = this.ctx.view();
    let dx = p.page.x - this.start.page.x;
    let dy = p.page.y - this.start.page.y;
    let lockX = false;
    let lockY = false;
    if (p.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        dy = 0;
        lockY = true;
      } else {
        dx = 0;
        lockX = true;
      }
    }
    const moved = { ...this.startBounds, x: this.startBounds.x + dx, y: this.startBounds.y + dy };
    const snap = snapRect(moved, this.targets, snapThreshold(view), { x: !lockX, y: !lockY });
    dx += snap.dx;
    dy += snap.dy;
    setSmartGuides(snap.lines);

    const changes = this.leaves.map((l) => ({ id: l.id, x: round4(l.x + dx), y: round4(l.y + dy) }));
    const key = JSON.stringify(changes);
    if (key === this.last) return;
    this.last = key;
    this.ctx.store.getState().dispatch(transformFrames, { changes });
  }

  up(): void {
    clearSmartGuides();
    if (!this.started) {
      this.onClick?.(this.ctx);
      return;
    }
    this.ctx.store.getState().commitTransaction();
    patchCanvasState({ gesture: null });
  }

  cancel(): void {
    clearSmartGuides();
    if (!this.started) return;
    this.ctx.store.getState().cancelTransaction();
    this.ctx.store.getState().setSelection(this.originalIds);
    patchCanvasState({ gesture: null });
  }
}
