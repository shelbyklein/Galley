// IPC for File > Export > PDF/X-4 (and, from P1-07, soft proofing). Registered once from src/main/index.ts.
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_IPC, type ExportPdfRequest, type ExportPdfResponse, type ExportProgress } from '../../shared/export-ipc';
import { getMissingLinks } from '../package';
import { runExportPipeline, type ExportPipelineRequest } from './pipeline';
import { currentProfileInfo, softProofColors } from './softproof';

let exporting = false;

/** One line from anything thrown: the dialog shows it, the full error goes to the log. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exportPdf(sender: Electron.WebContents, request: ExportPdfRequest): Promise<ExportPdfResponse> {
  if (exporting) return { status: 'error', message: 'An export is already running.' };
  // A missing image would print as the editor's placeholder, so a press PDF is refused until the links are fixed.
  const missing = getMissingLinks();
  if (missing.length > 0) {
    const list = missing.map((m) => m.path).join(', ');
    return { status: 'error', message: `${missing.length} linked ${missing.length === 1 ? 'image is' : 'images are'} missing (${list}). Restore ${missing.length === 1 ? 'it' : 'them'} before exporting.` };
  }
  exporting = true;
  try {
    const parent = BrowserWindow.fromWebContents(sender);
    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Export PDF/X-4',
      defaultPath: `${request.suggestedName.replace(/[\\/:]/g, '-')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    };
    // e2e tests replace dialog.showSaveDialog in this process, so it is looked up at call time
    const save = await (parent ? dialog.showSaveDialog(parent, dialogOptions) : dialog.showSaveDialog(dialogOptions));
    if (save.canceled || !save.filePath) return { status: 'canceled' };
    const target = save.filePath.toLowerCase().endsWith('.pdf') ? save.filePath : `${save.filePath}.pdf`;

    const progress = (p: ExportProgress) => {
      if (!sender.isDestroyed()) sender.send(EXPORT_IPC.exportProgress, p);
    };
    const result = await runExportPipeline({ files: request.files, options: request.options, pageId: request.pageId, title: request.suggestedName }, progress);

    progress({ stage: 'saving', message: 'Saving the PDF' });
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, result.bytes);
    } catch (error) {
      throw new Error(`Could not save the PDF: ${messageOf(error)}`);
    }
    return {
      status: 'saved',
      summary: {
        path: target,
        bytes: result.bytes.length,
        profile: { name: result.profile.name, kind: result.profile.kind },
        sheet: result.sheet,
        trim: result.trim,
        spots: result.report.spots,
        warnings: result.warnings,
        fonts: result.fonts,
      },
    };
  } catch (error) {
    console.error('PDF export failed', error);
    return { status: 'error', message: messageOf(error) };
  } finally {
    exporting = false;
  }
}

export function registerExportHandlers(): void {
  ipcMain.handle(EXPORT_IPC.exportPdf, (event, request: ExportPdfRequest) => exportPdf(event.sender, request));
  ipcMain.handle(EXPORT_IPC.profileInfo, () => currentProfileInfo());
  ipcMain.handle(EXPORT_IPC.softProof, (_event, inks: [number, number, number, number][]) => softProofColors(inks));

  if (process.env.GALLEY_E2E === '1') {
    // Test scripts (Playwright's app.evaluate) run the same pipeline without the editor window: the geometry and golden
    // harnesses in scripts/ and the export e2e use it. Absent in normal runs.
    (globalThis as { __galleyExport?: unknown }).__galleyExport = { runToFile, currentProfileInfo, softProofColors };
  }
}

/**
 * Test hook: run the export pipeline and write the press PDF (and, optionally, Chromium's PDF before prepress) to files, so
 * the result crosses Playwright's evaluate boundary as a small JSON object.
 */
async function runToFile(request: ExportPipelineRequest, pdfPath: string, chromiumPdfPath?: string) {
  const result = await runExportPipeline(request);
  await fs.promises.writeFile(pdfPath, result.bytes);
  if (chromiumPdfPath) await fs.promises.writeFile(chromiumPdfPath, result.chromiumPdf);
  const { bytes: _bytes, chromiumPdf: _chromium, ...rest } = result;
  return rest;
}
