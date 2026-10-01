/**
 * The drawing tools: rectangle (M), ellipse (L), line (\), rectangle frame (F, an empty graphic frame for an image) and
 * the text frame the Type tool drags out. One drag is one undo step: the frame is added when the drag starts and resized
 * on every pointer move, inside a transaction. A drag that ends smaller than a point is cancelled. Shift constrains
 * (square, circle, 45 degree line); alt draws from the center.
 */
import {
  addFrame,
  createId,
  createStory,
  paint,
  SWATCH_BLACK,
  transformFrames,
  type Frame,
  type Id,
} from '@galley/model';
import { patchCanvasState } from '../../canvas/canvasState';
import { angleOf, distance, normalizeAngle, round4 } from '../../canvas/geometry';
import { collectSnapTargets, snapPoint, type SnapTarget } from '../../canvas/snap/engine';
import { targetLayerId } from '../actions';
import { clearSmartGuides, DRAG_THRESHOLD, setSmartGuides, snapThreshold, type Gesture, type GestureContext, type PointerInfo } from './types';

export type DrawKind = 'rect' | 'ellipse' | 'line' | 'image' | 'text';

const LABEL: Record<DrawKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', image: 'Rectangle Frame', text: 'Text Frame' };

/** Default look of new objects, as in InDesign: shapes get a 1 pt black stroke and no fill, frames get neither. */
const strokeBlack = () => ({ paint: paint(SWATCH_BLACK), weight: 1 });

function newFrame(kind: DrawKind, id: Id, layerId: Id): { frame: Frame; story?: ReturnType<typeof createStory> } {
  const box = { x: 0, y: 0, w: 0, h: 0, rotation: 0 };
  switch (kind) {
    case 'rect':
      return { frame: { id, type: 'rect', name: '', layerId, ...box, fill: null, stroke: strokeBlack() } };
    case 'ellipse':
      return { frame: { id, type: 'ellipse', name: '', layerId, ...box, fill: null, stroke: strokeBlack() } };
    case 'line':
      return { frame: { id, type: 'line', name: '', layerId, ...box, fill: null, stroke: strokeBlack() } };
    case 'image':
      return { frame: { id, type: 'image', name: '', layerId, ...box, fill: null, stroke: null, assetId: null, content: null } };
    case 'text': {
      const storyId = createId('story');
      return { frame: { id, type: 'text', name: '', layerId, ...box, fill: null, stroke: null, storyId, inset: 0 }, story: createStory(storyId, '') };
    }
  }
}

export class DrawGesture implements Gesture {
  private started = false;
  private id: Id = '';
  private targets: SnapTarget[] = [];
  private last = '';
  private box = { x: 0, y: 0, w: 0, h: 0, rotation: 0 };

  constructor(
    private readonly ctx: GestureContext,
    private readonly kind: DrawKind,
    private readonly start: PointerInfo,
  ) {}

  private begin(): boolean {
    const s = this.ctx.store.getState();
    const layer = targetLayerId(this.ctx.doc(), s.selection);
    if (!layer) return false; // every layer is hidden or locked
    this.id = createId('frm');
    const made = newFrame(this.kind, this.id, layer);
    s.beginTransaction(`Draw ${LABEL[this.kind]}`);
    s.dispatch(addFrame, { frame: made.frame, pageId: this.ctx.pageId(), story: made.story });
    this.targets = collectSnapTargets(this.ctx.doc(), this.ctx.pageId(), { guides: s.view.guidesVisible });
    patchCanvasState({ gesture: 'draw' });
    this.started = true;
    return true;
  }

  move(p: PointerInfo): void {
    if (!this.started) {
      if (distance(p.view, this.start.view) < DRAG_THRESHOLD) return;
      if (!this.begin()) return;
    }
    const view = this.ctx.view();
    const snap = snapPoint(p.page, this.targets, snapThreshold(view));
    // the start point snaps too, once, so the rectangle's first corner lands on the guide it was pressed near
    const a0 = this.start.page;
    const a = snapPoint(a0, this.targets, snapThreshold(view));
    const origin = { x: a0.x + a.dx, y: a0.y + a.dy };
    const end = { x: p.page.x + snap.dx, y: p.page.y + snap.dy };
    setSmartGuides(snap.lines);

    this.box = this.kind === 'line' ? this.lineBox(origin, end, p) : this.rectBox(origin, end, p);
    const change = { id: this.id, x: round4(this.box.x), y: round4(this.box.y), w: round4(this.box.w), h: round4(this.box.h), rotation: round4(this.box.rotation) };
    const key = JSON.stringify(change);
    if (key === this.last) return;
    this.last = key;
    this.ctx.store.getState().dispatch(transformFrames, { changes: [change] });
  }

  private rectBox(origin: { x: number; y: number }, end: { x: number; y: number }, p: PointerInfo) {
    let dx = end.x - origin.x;
    let dy = end.y - origin.y;
    if (p.shift) {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * size;
      dy = Math.sign(dy || 1) * size;
    }
    if (p.alt) return { x: origin.x - Math.abs(dx), y: origin.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy), rotation: 0 };
    return { x: Math.min(origin.x, origin.x + dx), y: Math.min(origin.y, origin.y + dy), w: Math.abs(dx), h: Math.abs(dy), rotation: 0 };
  }

  /** A line is a horizontal box of zero height, turned about its center (see the model's schema header). */
  private lineBox(origin: { x: number; y: number }, end: { x: number; y: number }, p: PointerInfo) {
    let angle = angleOf(origin, end);
    let length = distance(origin, end);
    if (p.shift) angle = Math.round(angle / 45) * 45;
    let from = origin;
    let to = end;
    if (p.shift) {
      const r = (angle * Math.PI) / 180;
      to = { x: origin.x + length * Math.cos(r), y: origin.y + length * Math.sin(r) };
    }
    if (p.alt) {
      from = { x: origin.x - (to.x - origin.x), y: origin.y - (to.y - origin.y) };
      length *= 2;
    }
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2;
    return { x: cx - length / 2, y: cy, w: length, h: 0, rotation: normalizeAngle(angle) };
  }

  up(): void {
    clearSmartGuides();
    if (!this.started) return;
    patchCanvasState({ gesture: null });
    const s = this.ctx.store.getState();
    const tooSmall = this.kind === 'line' ? this.box.w < 1 : this.box.w < 1 || this.box.h < 1;
    if (tooSmall) {
      s.cancelTransaction();
      return;
    }
    s.commitTransaction();
    s.setSelection([this.id]);
    if (this.kind === 'text') patchCanvasState({ textEdit: { frameId: this.id, caret: 'end' } });
  }

  cancel(): void {
    clearSmartGuides();
    if (!this.started) return;
    patchCanvasState({ gesture: null });
    this.ctx.store.getState().cancelTransaction();
  }
}
