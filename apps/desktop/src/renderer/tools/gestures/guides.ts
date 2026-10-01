/**
 * Ruler guides: drag one out of a ruler to create it, drag an existing one to move it, drag it back onto its ruler to
 * delete it. Guides live in the model (`guide.add`, `guide.move`, `guide.remove`), so each of these is one undo step.
 */
import { addGuide, createId, moveGuide, removeGuide, type GalleyDocument, type Id } from '@galley/model';
import { patchCanvasState } from '../../canvas/canvasState';
import { distance, round4 } from '../../canvas/geometry';
import { pageToView, type ViewTransform, type Point } from '../../canvas/viewport';
import { DRAG_THRESHOLD, type Gesture, type GestureContext, type PointerInfo } from './types';

/** How close to a guide a press grabs it, CSS pixels. */
export const GUIDE_HIT_PX = 3;

/** The ruler guide of the page under `viewPoint`, if any. */
export function hitGuide(doc: GalleyDocument, pageId: Id, view: ViewTransform, viewPoint: Point): Id | null {
  for (const g of Object.values(doc.guides)) {
    if (g.pageId !== pageId) continue;
    const at = pageToView(view, g.orientation === 'vertical' ? { x: g.position, y: 0 } : { x: 0, y: g.position });
    const d = Math.abs(g.orientation === 'vertical' ? viewPoint.x - at.x : viewPoint.y - at.y);
    if (d <= GUIDE_HIT_PX) return g.id;
  }
  return null;
}

/** A guide's position along its axis for a pointer position (page points). */
const along = (orientation: 'horizontal' | 'vertical', page: Point): number => (orientation === 'vertical' ? page.x : page.y);
/** True when the pointer is over the ruler a guide of this orientation comes from (above or left of the pasteboard). */
const overRuler = (orientation: 'horizontal' | 'vertical', view: Point): boolean => (orientation === 'vertical' ? view.x < 0 : view.y < 0);

/** Pressing a ruler: a new guide follows the pointer from the moment of the press. Released over the ruler it is discarded. */
export class GuideCreateGesture implements Gesture {
  private readonly id: Id;

  constructor(
    private readonly ctx: GestureContext,
    private readonly orientation: 'horizontal' | 'vertical',
    start: PointerInfo,
  ) {
    const s = ctx.store.getState();
    this.id = createId('gd');
    if (!s.view.guidesVisible) s.setView({ guidesVisible: true });
    s.beginTransaction('Create Guide');
    s.dispatch(addGuide, { guide: { id: this.id, orientation, position: round4(along(orientation, start.page)), pageId: ctx.pageId() } });
    patchCanvasState({ gesture: 'guide', cursor: orientation === 'vertical' ? 'ew-resize' : 'ns-resize' });
  }

  move(p: PointerInfo): void {
    this.ctx.store.getState().dispatch(moveGuide, { id: this.id, position: round4(along(this.orientation, p.page)) });
  }

  up(p: PointerInfo): void {
    patchCanvasState({ gesture: null });
    if (overRuler(this.orientation, p.view)) this.ctx.store.getState().cancelTransaction();
    else this.ctx.store.getState().commitTransaction();
  }

  cancel(): void {
    patchCanvasState({ gesture: null });
    this.ctx.store.getState().cancelTransaction();
  }
}

/** Dragging an existing guide. Dropped on the ruler it came from, it is deleted. */
export class GuideMoveGesture implements Gesture {
  private started = false;
  private readonly orientation: 'horizontal' | 'vertical';
  private readonly offset: number;

  constructor(
    private readonly ctx: GestureContext,
    private readonly id: Id,
    private readonly start: PointerInfo,
  ) {
    const g = ctx.doc().guides[id]!;
    this.orientation = g.orientation;
    this.offset = g.position - along(g.orientation, start.page);
  }

  move(p: PointerInfo): void {
    const s = this.ctx.store.getState();
    if (!this.started) {
      if (distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
      s.beginTransaction('Move Guide');
      patchCanvasState({ gesture: 'guide', cursor: this.orientation === 'vertical' ? 'ew-resize' : 'ns-resize' });
      this.started = true;
    }
    s.dispatch(moveGuide, { id: this.id, position: round4(along(this.orientation, p.page) + this.offset) });
  }

  up(p: PointerInfo): void {
    if (!this.started) return;
    patchCanvasState({ gesture: null });
    const s = this.ctx.store.getState();
    if (overRuler(this.orientation, p.view)) {
      s.cancelTransaction();
      s.dispatch(removeGuide, { id: this.id });
    } else {
      s.commitTransaction();
    }
  }

  cancel(): void {
    if (!this.started) return;
    patchCanvasState({ gesture: null });
    this.ctx.store.getState().cancelTransaction();
  }
}
