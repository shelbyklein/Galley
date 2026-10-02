/**
 * Placement of document geometry on the printed sheet. All numbers are points; CSS `pt` maps one to one.
 *
 * The sheet is the trim box plus `max(bleed, slug)` on every side (`sheetSize` in @galley/model). A page's own
 * coordinates start at the trim box's top-left, so everything on the sheet is offset by `(origin.x, origin.y)`.
 *
 * Why this lives in one module: spikes/press/FINDINGS.md found that CSS boxes snap to whole CSS pixels (0.75 pt) in
 * the PDF, while SVG shapes are exact. Shapes are therefore drawn as SVG on sheet-sized `<svg>` elements at (0, 0),
 * whose own box never needs sub-pixel placement. Text and image frames are HTML boxes, positioned by `htmlFrameStyle`
 * (a translate transform: see its comment and GEOMETRY.md for the measurements behind it).
 */
import { sheetInsets, sheetSize, type BoxFrame, type Page } from '@galley/model';
import type { CSSProperties } from 'react';

/** `36pt`, with float noise trimmed to 4 decimals. */
export function pt(n: number): string {
  return `${Math.round(n * 10000) / 10000}pt`;
}

/** A plain number trimmed the same way, for SVG attributes (user units are points). */
export function num(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface SheetGeometry {
  /** Printed sheet size: trim plus bleed/slug. */
  width: number;
  height: number;
  /** Where the page's (0, 0) sits on the sheet. */
  origin: { x: number; y: number };
  /** The trim box on the sheet. */
  trim: { x: number; y: number; width: number; height: number };
}

export function sheetGeometry(page: Page): SheetGeometry {
  const insets = sheetInsets(page);
  const { width, height } = sheetSize(page);
  return { width, height, origin: { x: insets.left, y: insets.top }, trim: { x: insets.left, y: insets.top, width: page.width, height: page.height } };
}

/**
 * The box of a text or image frame, in sheet coordinates, rotated about its center.
 *
 * P1-04 measured four ways to place it in the PDF (packages/render/GEOMETRY.md):
 *   left/top   the box snaps to whole CSS pixels (0.75 pt) and, worse, the text baseline snaps vertically: up to 0.375 pt off
 *   foreignObject   the same snapping as left/top
 *   transform: translate()   exact: baseline and clip land within 0.01 pt of the model (the translation is written to the
 *                            PDF as a matrix, not laid out), so this is the method
 *   left/top whole px + translate for the rest   identical to translate() alone
 * The box therefore sits at the sheet origin and is moved by `translate`. Its clip is `clip-path: inset(0)`, not
 * `overflow: hidden`, because an overflow clip snaps the box size to whole pixels (up to 0.375 pt) and a clip-path does not.
 * Callers must not add `overflow: hidden` to the frame (page.css has none).
 */
export function htmlFrameStyle(frame: Pick<BoxFrame, 'x' | 'y' | 'w' | 'h' | 'rotation'>, origin: { x: number; y: number }): CSSProperties {
  const transform = [`translate(${pt(origin.x + frame.x)}, ${pt(origin.y + frame.y)})`];
  if (frame.rotation !== 0) transform.push(`rotate(${num(frame.rotation)}deg)`);
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: pt(frame.w),
    height: pt(frame.h),
    transform: transform.join(' '),
    clipPath: 'inset(0)',
  };
}

/** How far the bleed box is inside the sheet on each side: the export clips everything to the bleed box. */
export function bleedClipInsets(page: Page) {
  const insets = sheetInsets(page);
  return {
    top: Math.max(0, insets.top - page.bleed.top),
    right: Math.max(0, insets.right - page.bleed.right),
    bottom: Math.max(0, insets.bottom - page.bleed.bottom),
    left: Math.max(0, insets.left - page.bleed.left),
  };
}
