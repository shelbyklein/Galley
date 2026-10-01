/**
 * Zoom and fit actions, shared by the View commands, the wheel and the zoom tool. They read and write the store's
 * `viewport` and use the pasteboard size the canvas measured (`canvasState().size`; a default before it is mounted).
 */
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../store';
import { canvasState } from './canvasState';
import { fitPage, stepZoom, zoomAt, type Size } from './viewport';

type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

/** The pasteboard of a 1440 x 900 window, used when nothing has been measured yet. */
const DEFAULT_SIZE: Size = { width: 1078, height: 782 };

export const pasteboardSize = (): Size => canvasState().size ?? DEFAULT_SIZE;

/** Zoom one preset in or out about the center of the pasteboard. */
export function zoomStepAboutCenter(store: StoreLike, direction: 'in' | 'out'): void {
  const s = store.getState();
  const size = pasteboardSize();
  const v = s.viewport;
  s.setViewport({ ...zoomAt(v, stepZoom(v.zoom, direction), { x: size.width / 2, y: size.height / 2 }), fit: false });
}

/** Set an exact zoom (100% for Actual Size), about the center of the pasteboard. */
export function zoomToAboutCenter(store: StoreLike, zoom: number): void {
  const s = store.getState();
  const size = pasteboardSize();
  s.setViewport({ ...zoomAt(s.viewport, zoom, { x: size.width / 2, y: size.height / 2 }), fit: false });
}

/** Fit the page in the window; the canvas keeps it fitted when the window resizes until the next zoom or pan. */
export function fitPageInWindow(store: StoreLike): void {
  const s = store.getState();
  const page = s.history.doc.pages[s.currentPageId];
  if (!page) return;
  s.setViewport({ ...fitPage(pasteboardSize(), page), fit: true });
}
