/**
 * Viewport math, pure and DOM-free (unit-tested in viewport.test.ts).
 *
 * Coordinates:
 *   page    points from the top-left of the current page's trim box (what the model stores)
 *   view    CSS pixels from the top-left of the pasteboard, the canvas area below and right of the rulers
 *   client  CSS pixels in the window (what pointer events give); view = client - the pasteboard's bounding-box origin
 *
 * `Viewport` (in the store) is `{ zoom, panX, panY }` with zoom in CSS pixels per point and (panX, panY) the view
 * position of page point (0, 0): `view = pan + page * zoom`.
 */
import { sheetInsets, sheetSize, type Page, type Rect } from '@galley/model';

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 40;
/** Pasteboard padding around the sheet when fitting the page, CSS pixels. */
export const FIT_PADDING = 24;

/** InDesign's zoom presets (⌘= and ⌘− step through them): 5, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 75, 100 ... 4000 percent. */
export const ZOOM_STEPS: readonly number[] = [0.05, 0.0625, 1 / 12, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40];

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The next preset above (`in`) or below (`out`) the current zoom. At either end the zoom stays where it is. */
export function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  const eps = 1e-6;
  if (direction === 'in') return ZOOM_STEPS.find((z) => z > zoom * (1 + eps)) ?? Math.max(zoom, MAX_ZOOM);
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i]! < zoom * (1 - eps)) return ZOOM_STEPS[i]!;
  return Math.min(zoom, MIN_ZOOM);
}

/** `63%`, `66.7%`, `1200%`: the zoom readout. */
export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  const text = Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1);
  return `${text}%`;
}

export const pageToView = (v: ViewTransform, p: Point): Point => ({ x: v.panX + p.x * v.zoom, y: v.panY + p.y * v.zoom });
export const viewToPage = (v: ViewTransform, p: Point): Point => ({ x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom });

/** Zoom to `zoom`, keeping the page point under view position `focal` where it is. */
export function zoomAt(v: ViewTransform, zoom: number, focal: Point): ViewTransform {
  const z = clampZoom(zoom);
  const k = z / v.zoom;
  return { zoom: z, panX: focal.x - (focal.x - v.panX) * k, panY: focal.y - (focal.y - v.panY) * k };
}

/** Fit the printed sheet (trim plus bleed or slug) in the view, centered. Pan is whole pixels so edges stay crisp. */
export function fitPage(size: Size, page: Page, padding = FIT_PADDING): ViewTransform {
  const sheet = sheetSize(page);
  const insets = sheetInsets(page);
  const zoom = clampZoom(Math.min((size.width - 2 * padding) / sheet.width, (size.height - 2 * padding) / sheet.height));
  const left = (size.width - sheet.width * zoom) / 2;
  const top = (size.height - sheet.height * zoom) / 2;
  return { zoom, panX: Math.round(left + insets.left * zoom), panY: Math.round(top + insets.top * zoom) };
}

/** Zoom to `zoom` with the whole page centered in the view. */
export function centerPageAt(size: Size, page: Page, zoom: number): ViewTransform {
  const z = clampZoom(zoom);
  return { zoom: z, panX: Math.round((size.width - page.width * z) / 2), panY: Math.round((size.height - page.height * z) / 2) };
}

/** Fit a page-space rectangle into the view (the zoom tool's marquee), centered. */
export function zoomToRect(size: Size, rect: Rect, padding = 12): ViewTransform {
  const zoom = clampZoom(Math.min((size.width - 2 * padding) / Math.max(rect.w, 1e-6), (size.height - 2 * padding) / Math.max(rect.h, 1e-6)));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { zoom, panX: size.width / 2 - cx * zoom, panY: size.height / 2 - cy * zoom };
}

export const roundTo = (value: number, places = 4): number => {
  const k = 10 ** places;
  return Math.round(value * k) / k;
};

export const sameView = (a: ViewTransform, b: ViewTransform): boolean =>
  Math.abs(a.zoom - b.zoom) < 1e-9 && Math.abs(a.panX - b.panX) < 1e-6 && Math.abs(a.panY - b.panY) < 1e-6;
