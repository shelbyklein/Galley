// @galley/prepress/verify: measuring a PDF, for tests (geometry, golden separations). Node only; needs Ghostscript, qpdf and
// poppler for the parts that run them. Not imported by the app.
export { measurePdfGeometry, type Box, type PaintedPath, type PdfGeometry, type TextRun } from './geometry.ts';
