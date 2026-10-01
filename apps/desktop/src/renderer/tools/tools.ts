/**
 * Which behavior the active tool gives a pointer press, and the cursor it shows. The tool ids are the store's `ToolId`
 * values (lane C's tool commands set them): select, type, line, rectangle, rectangle-frame, ellipse, hand, zoom.
 */
import { patchCanvasState } from '../canvas/canvasState';
import { type Handle, HANDLE_DIR } from '../canvas/geometry';
import type { Point } from '../canvas/viewport';
import { hitTest } from './hit-test';
import { normalizeSelection, selectionBox } from './selection-model';
import { DrawGesture, type DrawKind } from './gestures/draw';
import { hitGuide } from './gestures/guides';
import { PanGesture, ZoomGesture } from './gestures/pan';
import { beginSelectGesture } from './gestures/select';
import { hitHandle } from './gestures/transform';
import type { Gesture, GestureContext, PointerInfo } from './gestures/types';

export type Tool = 'select' | 'type' | 'line' | 'rectangle' | 'rectangle-frame' | 'ellipse' | 'hand' | 'zoom';

/** The tool a store value means. Accepts the command-style spellings too (`selection`, `rectangleFrame`). */
export function normalizeTool(value: string): Tool {
  switch (value) {
    case 'selection':
    case 'select':
      return 'select';
    case 'rectangleFrame':
    case 'rectangle-frame':
      return 'rectangle-frame';
    case 'type':
    case 'line':
    case 'rectangle':
    case 'ellipse':
    case 'hand':
    case 'zoom':
      return value;
    default:
      return 'select';
  }
}

const DRAW_KIND: Partial<Record<Tool, DrawKind>> = { rectangle: 'rect', ellipse: 'ellipse', line: 'line', 'rectangle-frame': 'image', type: 'text' };

/** A press on the pasteboard. Returns the gesture to follow, or null when the press needs no tracking. */
export function beginToolGesture(ctx: GestureContext, tool: Tool, p: PointerInfo, panOverride: boolean): Gesture | null {
  if (panOverride || tool === 'hand') return new PanGesture(ctx, p);
  if (tool === 'zoom') return new ZoomGesture(ctx, p);
  if (tool === 'select') return beginSelectGesture(ctx, p);

  if (tool === 'type') {
    // pressing inside an existing text frame puts the caret there; otherwise drag out a new text frame
    const hit = hitTest(ctx.doc(), ctx.pageId(), p.page, 0);
    const frame = hit ? ctx.doc().frames[hit] : undefined;
    if (frame?.type === 'text') {
      ctx.store.getState().setSelection([frame.id]);
      patchCanvasState({ textEdit: { frameId: frame.id, caret: { clientX: p.client.x, clientY: p.client.y } } });
      return null;
    }
    ctx.store.getState().clearSelection();
  }
  const kind = DRAW_KIND[tool];
  return kind ? new DrawGesture(ctx, kind, p) : null;
}

/** Cursor for a pointer hovering at `view` (pasteboard pixels) with no gesture running. */
export function cursorFor(ctx: GestureContext, tool: Tool, spaceHeld: boolean, view: Point, alt: boolean): string {
  if (spaceHeld || tool === 'hand') return 'grab';
  if (tool === 'zoom') return alt ? 'zoom-out' : 'zoom-in';
  if (tool === 'type') return 'text';
  if (tool !== 'select') return 'crosshair';

  const doc = ctx.doc();
  const v = ctx.view();
  const store = ctx.store.getState();
  const sb = selectionBox(doc, normalizeSelection(doc, store.selection));
  if (sb) {
    const hit = hitHandle(sb, v, view);
    if (hit?.kind === 'resize') return resizeCursor(hit.handle, sb.box.rotation);
    if (hit?.kind === 'rotate') return ROTATE_CURSOR;
  }
  if (store.view.guidesVisible) {
    const id = hitGuide(doc, ctx.pageId(), v, view);
    const g = id ? doc.guides[id] : undefined;
    if (g) return g.orientation === 'vertical' ? 'ew-resize' : 'ns-resize';
  }
  return 'default';
}

/** The resize cursor for a handle, turned with the box: a corner of a box turned 45 degrees points the way an edge would. */
export function resizeCursor(handle: Handle, rotation: number): string {
  const d = HANDLE_DIR[handle];
  const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI + rotation; // direction the handle points, degrees clockwise from +x
  const bucket = ((Math.round(angle / 45) % 8) + 8) % 8; // 0 = east, 1 = south-east, ...
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][bucket]!;
}

/** A curved-arrow rotate cursor (an inline SVG data URL, hotspot in the middle). */
export const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cpath d='M4 11a6 6 0 1 0 2-5' fill='none' stroke='white' stroke-width='3.2'/%3E%3Cpath d='M4 11a6 6 0 1 0 2-5' fill='none' stroke='black' stroke-width='1.4'/%3E%3Cpath d='M2 3l5 1-1 5z' fill='black' stroke='white' stroke-width='1'/%3E%3C/svg%3E\") 10 10, crosshair";

/** Double-clicking a text frame with the Selection tool switches to the Type tool and puts the caret there. */
export function handleDoubleClick(ctx: GestureContext, p: PointerInfo): void {
  const s = ctx.store.getState();
  if (normalizeTool(s.activeTool) !== 'select') return;
  const hit = hitTest(ctx.doc(), ctx.pageId(), p.page, 0);
  const frame = hit ? ctx.doc().frames[hit] : undefined;
  if (frame?.type !== 'text') return;
  s.setSelection([frame.id]);
  s.setActiveTool('type');
  patchCanvasState({ textEdit: { frameId: frame.id, caret: { clientX: p.client.x, clientY: p.client.y } } });
}
