import { patchCanvasState } from '../../canvas/canvasState';
import { distance, normalizeRect } from '../../canvas/geometry';
import { stepZoom, zoomAt, zoomToRect } from '../../canvas/viewport';
import { DRAG_THRESHOLD, type Gesture, type GestureContext, type PointerInfo } from './types';

/** Hand tool, space-drag and middle-drag: the view follows the pointer. */
export class PanGesture implements Gesture {
  private readonly origin: { panX: number; panY: number };

  constructor(
    private readonly ctx: GestureContext,
    private readonly start: PointerInfo,
  ) {
    const v = ctx.view();
    this.origin = { panX: v.panX, panY: v.panY };
    patchCanvasState({ cursor: 'grabbing' });
  }

  move(p: PointerInfo): void {
    this.ctx.store.getState().setViewport({ panX: this.origin.panX + (p.client.x - this.start.client.x), panY: this.origin.panY + (p.client.y - this.start.client.y), fit: false });
  }

  up(): void {
    patchCanvasState({ cursor: 'grab' });
  }

  cancel(): void {
    this.ctx.store.getState().setViewport({ panX: this.origin.panX, panY: this.origin.panY, fit: false });
  }
}

/** Zoom tool: a click zooms in one step at the point (alt-click out); a drag zooms to the rectangle. */
export class ZoomGesture implements Gesture {
  private dragging = false;

  constructor(
    private readonly ctx: GestureContext,
    private readonly start: PointerInfo,
  ) {}

  move(p: PointerInfo): void {
    if (!this.dragging && distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
    this.dragging = true;
    patchCanvasState({ marquee: { rect: normalizeRect(this.start.view, p.view), kind: 'zoom' } });
  }

  up(p: PointerInfo): void {
    patchCanvasState({ marquee: null });
    const store = this.ctx.store.getState();
    const v = this.ctx.view();
    if (this.dragging) {
      const a = this.start.page;
      const b = p.page;
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      if (rect.w * v.zoom < 4 && rect.h * v.zoom < 4) return;
      store.setViewport({ ...zoomToRect(this.ctx.size(), rect), fit: false });
      return;
    }
    store.setViewport({ ...zoomAt(v, stepZoom(v.zoom, this.start.alt ? 'out' : 'in'), this.start.view), fit: false });
  }

  cancel(): void {
    patchCanvasState({ marquee: null });
  }
}
