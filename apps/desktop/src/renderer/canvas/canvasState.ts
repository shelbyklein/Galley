/**
 * Transient canvas UI state: things that exist only while the user is interacting and that nothing outside the canvas
 * needs (marquee, smart guide lines, the text frame being edited, the measured size). It is NOT the editor store: nothing
 * here is document data, and none of it is in undo history. (Selection, viewport, tool, view settings live in the editor
 * store because panels and menus read them.)
 */
import type { Id, Rect } from '@galley/model';
import { create } from 'zustand';
import type { Size } from './viewport';

/** A smart guide line, in page points. `axis: 'x'` is a vertical line at x = `value` running from `from` to `to` in y. */
export interface SmartGuideLine {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
  /** `center X`, `center Y`: shown on a small tag, as in the mockup. */
  label?: string;
}

export interface CanvasState {
  /** The pasteboard's size in CSS pixels (below and right of the rulers); null until measured. */
  size: Size | null;
  /** The marquee while dragging, in pasteboard pixels, with its purpose (selection or zoom). */
  marquee: { rect: Rect; kind: 'select' | 'zoom' } | null;
  smartGuides: SmartGuideLine[];
  /** A text frame being edited in place. */
  textEdit: { frameId: Id; caret: { clientX: number; clientY: number } | 'end' } | null;
  /** Space is held: the next drag pans, whatever the active tool is. */
  spaceHeld: boolean;
  /** The CSS cursor over the pasteboard. */
  cursor: string;
  /** A gesture is in progress (a transaction may be open); commands that change the document wait for it. */
  gesture: string | null;
}

export const useCanvasState = create<CanvasState>()(() => ({
  size: null,
  marquee: null,
  smartGuides: [],
  textEdit: null,
  spaceHeld: false,
  cursor: 'default',
  gesture: null,
}));

export const canvasState = (): CanvasState => useCanvasState.getState();
export const patchCanvasState = (patch: Partial<CanvasState>): void => useCanvasState.setState(patch);
