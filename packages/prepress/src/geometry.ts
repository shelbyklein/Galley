// Export geometry: how the export options (bleed on/off, crop marks on/off) change the printed sheet, and where the
// PDF page boxes go. Pure functions of the document, with no Node or PDF dependency, so any process can use them.
import { sheetInsets, sheetSize, type GalleyDocument, type Insets, type Page } from '@galley/model';

// ------------------------------------------------------------------------------------------------------ mark metrics

/** Gap between the bleed edge and where a crop mark starts. */
export const MARK_GAP = 3;
/** Length of each crop-mark tick. */
export const MARK_LENGTH = 18;
/** Distance from the bleed edge to the center of a registration target. */
export const TARGET_OFFSET = 15;
export const TARGET_RADIUS = 5;
export const TARGET_ARM = 9;
export const MARK_WEIGHT = 0.25;

/**
 * How far beyond the trim edge the marks reach, for a side with this much bleed: the bleed, the registration target
 * (offset plus arm) and 3 pt to spare. With the default 9 pt bleed that is exactly 36 pt (0.5 in).
 */
export function marksReach(bleed: number): number {
  return bleed + TARGET_OFFSET + TARGET_ARM + 3;
}

// ----------------------------------------------------------------------------------------------------- export options

export interface ExportOptions {
  /** Include the document's bleed. Off: art is clipped at the trim edge and the BleedBox equals the TrimBox. */
  bleed: boolean;
  /** Draw crop marks and registration targets (in /Separation /All, so they print on every plate). */
  marks: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { bleed: true, marks: true };

const zeroInsets = (): Insets => ({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * The page as it prints with these options:
 *   - `bleed` off: bleed is 0 on every side, so the art is clipped at the trim edge and the BleedBox equals the TrimBox;
 *   - `marks` on: the slug is at least what the marks need (`marksReach`), so they are never clipped; the document's own
 *     slug applies only then (the slug area holds marks and job info);
 *   - `marks` off: no slug.
 * The printed sheet is then `trim + max(bleed, slug)` per side, the model's rule (`sheetSize`) applied to this page, so
 * with the defaults a poster with 9 pt bleed and 36 pt slug prints on the same sheet the editor shows.
 */
export function exportPage(page: Page, options: ExportOptions): Page {
  const bleed = options.bleed ? { ...page.bleed } : zeroInsets();
  const slug = zeroInsets();
  if (options.marks) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) slug[side] = Math.max(page.slug[side], marksReach(bleed[side]));
  }
  return { ...page, bleed, slug };
}

/** A copy of the document whose pages have been through `exportPage`. Export renders and post-processes this copy. */
export function applyExportOptions(doc: GalleyDocument, options: ExportOptions): GalleyDocument {
  const pages = Object.fromEntries(Object.entries(doc.pages).map(([id, page]) => [id, exportPage(page, options)]));
  return { ...doc, pages };
}

// ---------------------------------------------------------------------------------------------------------- page boxes

/** Where the boxes of one printed page go, in points, measured from the top-left of the sheet (CSS orientation). */
export interface PageBoxes {
  /** The printed sheet: the MediaBox and CropBox. */
  sheet: { width: number; height: number };
  /** The TrimBox: exactly the page size. */
  trim: { x: number; y: number; width: number; height: number };
  /** Bleed beyond the trim on each side (BleedBox = trim grown by this). */
  bleed: Insets;
}

export function pageBoxes(page: Page): PageBoxes {
  const insets = sheetInsets(page);
  return {
    sheet: sheetSize(page),
    trim: { x: insets.left, y: insets.top, width: page.width, height: page.height },
    bleed: { ...page.bleed },
  };
}
