import type { FontBinding } from '@galley/fonts/types';
// The hidden export window: loads src/export-page, renders one page of the document in export mode (every document color
// a sentinel RGB), and prints it with Chromium's printToPDF. The result is an RGB PDF that @galley/prepress turns into a
// press-ready PDF/X-4.
import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { DocumentFiles, SentinelEntry } from '@galley/model';

/** What `window.galleyExport.load` returns (src/export-page/main.tsx). */
interface LoadResult {
  pageId: string;
  sheet: { width: number; height: number };
  sentinels: SentinelEntry[];
}

interface PaintedColor {
  where: string;
  property: string;
  value: string;
}

export interface ChromiumRender {
  /** Chromium's PDF: one page, DeviceRGB, sentinel colors. Not press-ready. */
  pdf: Buffer;
  pageId: string;
  sheet: { width: number; height: number };
  sentinels: SentinelEntry[];
}

/** Where the export page lives: the dev server under `npm run dev`, else the built output next to the main bundle. */
function exportPageTarget(): { url: string } | { file: string } {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) return { url: `${dev}/export-page/index.html` };
  return { file: join(__dirname, '../renderer/export-page/index.html') };
}

/**
 * Render one page of the document in a hidden window and print it. The window is always destroyed, also on failure.
 * Throws when the page paints a color that is not a sentinel: that color would reach the press as RGB.
 */
export async function renderPageToPdf(files: DocumentFiles, pageId?: string, fonts?: FontBinding[]): Promise<ChromiumRender> {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    const target = exportPageTarget();
    if ('url' in target) await win.loadURL(target.url);
    else await win.loadFile(target.file);
    const run = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;

    const loaded = await run<LoadResult>(`window.galleyExport.load(${JSON.stringify(files)}, ${JSON.stringify(pageId ?? null)}, ${JSON.stringify(fonts ?? null)})`);
    const stray = await run<PaintedColor[]>('window.galleyExport.audit()');
    if (stray.length > 0) {
      const list = stray.slice(0, 5).map((c) => `${c.where} ${c.property}: ${c.value}`).join('; ');
      throw new Error(`The export page painted ${stray.length} color(s) that are not document colors (${list}). Exporting them would put RGB on the press.`);
    }

    // Electron 44's printToPDF has no marginType: zero margins in inches, the CSS @page size, backgrounds on.
    const pdf = await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      scale: 1,
      generateTaggedPDF: false,
      generateDocumentOutline: false,
    });
    return { pdf, pageId: loaded.pageId, sheet: loaded.sheet, sentinels: loaded.sentinels };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
