// The export pipeline: document -> export copy (bleed / marks options) -> hidden window + printToPDF -> prepress -> PDF/X-4.
// No dialogs or IPC here (see handlers.ts), so tests and scripts can run the same code path through `__galleyExport`.
import { buildSentinelTable, parseDocument, serializeDocument, type DocumentFiles } from '@galley/model';
import { applyExportOptions, pageBoxes, prepress, selectProfiles, type ExportOptions, type PrepressReport } from '@galley/prepress';
import type { ExportProgress } from '../../shared/export-ipc';
import { renderPageToPdf } from './render';

export interface ExportPipelineRequest {
  files: DocumentFiles;
  options: ExportOptions;
  /** PDF title. */
  title?: string;
  pageId?: string;
  /** `cmyk` (default) converts photos through the output profile; `rgb-icc` keeps them ICC-tagged RGB. */
  photoMode?: 'cmyk' | 'rgb-icc';
}

export interface ExportPipelineResult {
  bytes: Uint8Array;
  /** Chromium's PDF before prepress, for tests that measure geometry. */
  chromiumPdf: Buffer;
  report: PrepressReport;
  pageId: string;
  sheet: { width: number; height: number };
  trim: { width: number; height: number };
  profile: { name: string; kind: 'press' | 'fallback'; path: string };
  warnings: string[];
}

export async function runExportPipeline(request: ExportPipelineRequest, onProgress: (p: ExportProgress) => void = () => {}): Promise<ExportPipelineResult> {
  const profiles = selectProfiles();
  if (!profiles.output) throw new Error(profiles.note ?? 'No CMYK output profile was found.');
  if (!profiles.srgbPath) throw new Error('The sRGB profile (/System/Library/ColorSync/Profiles/sRGB Profile.icc) was not found.');

  // The page as it prints with these options (bleed off: no bleed; marks on: a slug big enough for them).
  const doc = parseDocument(request.files);
  const pageId = request.pageId ?? doc.pageOrder[0]!;
  if (!doc.pages[pageId]) throw new Error(`The document has no page "${pageId}".`);
  const exportDoc = applyExportOptions(doc, request.options);
  const exportFiles = serializeDocument(exportDoc);
  const sentinels = buildSentinelTable(exportDoc);

  onProgress({ stage: 'rendering', message: 'Rendering the page' });
  const rendered = await renderPageToPdf(exportFiles, pageId);
  // The renderer and the prepress step must agree on every sentinel: they build the table from the same function.
  if (JSON.stringify(rendered.sentinels) !== JSON.stringify(sentinels)) throw new Error('The export page and the prepress step disagree about the sentinel colors; refusing to export wrong inks.');

  onProgress({ stage: 'prepress', message: 'Converting colors for press' });
  const page = exportDoc.pages[pageId]!;
  const { bytes, report } = await prepress(rendered.pdf, {
    sentinels,
    boxes: pageBoxes(page),
    outputIntent: { profilePath: profiles.output.path, ...profiles.output.intent },
    photoMode: request.photoMode ?? 'cmyk',
    srgbProfilePath: profiles.srgbPath,
    title: request.title ?? doc.meta.title,
    marks: request.options.marks,
  });

  const warnings: string[] = [];
  if (profiles.note) warnings.push(profiles.note);
  if (report.streams.some((s) => s.kind === 'type3')) {
    warnings.push('Some text was exported as Type 3 fonts (variable fonts and CFF .otf fonts do). Type 3 is valid in PDF/X-4, but some print shops flag it.');
  }
  if (report.unmatched.length > 0) warnings.push(`${report.unmatched.length} color(s) in the page were not document colors and were left as RGB: ${report.unmatched.slice(0, 3).join('; ')}`);
  if (report.unhandled.length > 0) warnings.push(`${report.unhandled.length} color operator(s) could not be converted: ${report.unhandled.slice(0, 3).join('; ')}`);
  if (report.shadings.unsupported.length > 0) warnings.push(`Unsupported gradient color(s): ${report.shadings.unsupported.slice(0, 3).join('; ')}`);
  if (report.skippedImages.length > 0) warnings.push(`${report.skippedImages.length} image(s) were not converted to CMYK: ${report.skippedImages.slice(0, 2).join('; ')}`);

  return {
    bytes,
    chromiumPdf: rendered.pdf,
    report,
    pageId,
    sheet: rendered.sheet,
    trim: { width: page.width, height: page.height },
    profile: { name: profiles.output.name, kind: profiles.output.kind, path: profiles.output.path },
    warnings,
  };
}
