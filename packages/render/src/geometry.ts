/**
 * Placement of document geometry on the printed sheet. All numbers are points; CSS `pt` maps one to one.
 *
 * The sheet is the trim box plus `max(bleed, slug)` on every side (`sheetSize` in @galley/model). A page's own
 * coordinates start at the trim box's top-left, so everything on the sheet is offset by `(origin.x, origin.y)`.
 *
 * Why this lives in one module: spikes/press/FINDINGS.md found that CSS boxes snap to whole CSS pixels (0.75 pt) in
 * the PDF, while SVG shapes are exact. Shapes are therefore drawn as SVG on sheet-sized `<svg>` elements at (0, 0),
 * whose own box never needs sub-pixel placement. Text and image frames are HTML boxes, positioned by
 * `htmlFrameStyle`; P1-04 (lane A) measures how exact that is at fractional positions and may change this function
 * (transform, left/top or foreignObject) without touching anything else.
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

/** The absolutely positioned box of a text or image frame, in sheet coordinates, rotated about its center. */
export function htmlFrameStyle(frame: Pick<BoxFrame, 'x' | 'y' | 'w' | 'h' | 'rotation'>, origin: { x: number; y: number }): CSSProperties {
  const style: CSSProperties = {
    position: 'absolute',
    left: pt(origin.x + frame.x),
    top: pt(origin.y + frame.y),
    width: pt(frame.w),
    height: pt(frame.h),
  };
  if (frame.rotation !== 0) style.transform = `rotate(${num(frame.rotation)}deg)`;
  return style;
}
