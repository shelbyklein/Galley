// @galley/prepress/verify: measuring a PDF, for tests (geometry, golden separations). Node only; needs Ghostscript, qpdf and
// poppler for the parts that run them. Not imported by the app.
export { measurePdfGeometry, type Box, type PaintedPath, type PdfGeometry, type TextRun } from './geometry.ts';
export { DEFAULT_DPI, measureRegion, separate, type Measure, type Separations } from './separations.ts';
export { readPlate, stats, type Plate, type Rect } from './plates.ts';
export { scanRgb } from './rgbscan.ts';
export { expectedPlates, formatChecks, runGoldenChecks, type Check, type GoldenInput } from './golden.ts';
