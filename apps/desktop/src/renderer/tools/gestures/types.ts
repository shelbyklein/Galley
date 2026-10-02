/**
 * What a gesture is. Pointer down picks a tool behavior, which returns a `Gesture` to follow the pointer until it is
 * released. Gestures do all their model changes inside one transaction (`beginTransaction` ... `commitTransaction`), so
 * every gesture is exactly one undo step, and Escape (`cancel`) restores the document from before it began.
 */
import type { GalleyDocument, Id } from '@galley/model';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../store';
import { patchCanvasState } from '../../canvas/canvasState';
import type { Point } from '../../canvas/geometry';
import { SNAP_PX } from '../../canvas/snap/engine';
import { viewToPage, type Size, type ViewTransform } from '../../canvas/viewport';

export type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

/** The pointer at one moment, in all three spaces, with the modifier keys. */
export interface PointerInfo {
  /** CSS pixels from the top-left of the pasteboard. */
  view: Point;
  /** Page points (current page). */
  page: Point;
  /** Window pixels, for moving the view and for placing a text caret. */
  client: Point;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Click count (2 on the second click of a double click). */
  detail: number;
}

export interface Gesture {
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  /** Escape, a lost pointer, or the canvas going away: undo everything the gesture did. */
  cancel(): void;
}

/** Everything a gesture needs to know about the canvas, read fresh each time so it never goes stale. */
export interface GestureContext {
  store: StoreLike;
  /** The current view transform (store viewport). */
  view(): ViewTransform;
  /** The pasteboard size. */
  size(): Size;
  doc(): GalleyDocument;
  pageId(): Id;
}

/** A drag starts after the pointer has moved this far, CSS pixels: a click that wobbles is still a click. */
export const DRAG_THRESHOLD = 3;

/** Tolerance for hitting thin things (outlines, lines, guides), CSS pixels. */
export const HIT_PX = 4;

export const snapThreshold = (view: ViewTransform): number => SNAP_PX / view.zoom;

export const setSmartGuides = (lines: import('../../canvas/canvasState').SmartGuideLine[]): void => patchCanvasState({ smartGuides: lines });
export const clearSmartGuides = (): void => patchCanvasState({ smartGuides: [] });

export function pointerInfo(e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; detail: number }, origin: Point, view: ViewTransform): PointerInfo {
  const v = { x: e.clientX - origin.x, y: e.clientY - origin.y };
  return { view: v, page: viewToPage(view, v), client: { x: e.clientX, y: e.clientY }, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, detail: e.detail };
}
