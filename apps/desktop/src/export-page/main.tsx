// Export page entry. Owned by lane A (apps/desktop/src/export-page/**).
//
// The hidden export window loads this page, calls `window.galleyExport.load(...)` with a document, waits for it to
// resolve, and then runs webContents.printToPDF. The page is drawn by the same @galley/render component the editor
// canvas uses, in export mode: every swatch is a sentinel RGB and nothing else paints a document color.
//
// Lane F's version (P1-03) renders one page 1:1 and reports what the prepress step needs. Lane A (P1-06) wires it to
// the export command and sets the page size and print options.
import '@galley/render/fonts';
import { buildSentinelTable, parseDocument, sheetSize, type SentinelEntry } from '@galley/model';
import { findNonSentinelColors, PageView, type PaintedColor } from '@galley/render';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { assetUrl } from '../shared/assets';
import type { PackageFiles } from '../shared/ipc';
import './export.css';

export interface ExportLoadResult {
  pageId: string;
  /** The printed sheet in points (trim plus bleed/slug). The PDF's MediaBox is exactly this after prepress. */
  sheet: { width: number; height: number };
  /** Sentinel RGB to ink table for this document; the prepress step uses the same table. */
  sentinels: SentinelEntry[];
}

export interface GalleyExportApi {
  /** Render one page (default: the first) in export mode. Resolves once fonts and images have loaded and painted. */
  load(files: PackageFiles, pageId?: string): Promise<ExportLoadResult>;
  /** Painted colors on the rendered page that are not sentinels. Empty means export-clean. */
  audit(): PaintedColor[];
}

declare global {
  interface Window {
    galleyExport?: GalleyExportApi;
  }
}

let root: Root | null = null;
let table: SentinelEntry[] = [];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForReady(): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (document.querySelector('.galley-page[data-ready="true"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The page did not finish loading its fonts and images');
}

window.galleyExport = {
  async load(files, pageId) {
    const doc = parseDocument(files);
    const id = pageId ?? doc.pageOrder[0]!;
    const page = doc.pages[id];
    if (!page) throw new Error(`No page "${id}"`);
    table = buildSentinelTable(doc);
    const sheet = sheetSize(page);

    // The printed sheet is exactly `sheet` (the .galley-page element). The `@page` size is a little larger: Chromium rounds
    // the page size to whole points, in either direction, and a page smaller than the sheet makes it shrink the content
    // to fit. A whole number of points that is at least one more than the sheet is never smaller than it, and the
    // prepress step crops the PDF to the exact sheet (packages/render/GEOMETRY.md, "Page size").
    let style = document.getElementById('galley-page-size');
    if (!style) {
      style = document.createElement('style');
      style.id = 'galley-page-size';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${Math.ceil(sheet.width) + 1}pt ${Math.ceil(sheet.height) + 1}pt; margin: 0; }`;

    root ??= createRoot(document.getElementById('root')!);
    flushSync(() => {
      root!.render(<PageView doc={doc} pageId={id} colorMode="export" assetUrl={(asset) => assetUrl(asset.path)} />);
    });
    await waitForReady();
    await document.fonts.ready;
    await nextFrame();
    await nextFrame();
    return { pageId: id, sheet, sentinels: table };
  },
  audit() {
    const el = document.querySelector('.galley-page');
    return el ? findNonSentinelColors(el, table) : [];
  },
};
