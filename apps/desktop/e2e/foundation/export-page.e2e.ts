import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';

// P1-03: the hidden export page (src/export-page) renders the same fixture with the same @galley/render component,
// in export mode, so every document color is a sentinel. This drives the *built* entry in a real hidden window, the
// way lane A's export command will, and prints it to PDF as a smoke check of the page setup.
test.use({ open: FIXTURES.posterBasic });

test('the export page paints sentinels only and prints a sheet-sized PDF', async ({ galley }) => {
  const exportUrl = pathToFileURL(path.join(APP_DIR, 'out/renderer/export-page/index.html')).href;
  const files = {
    document: fs.readFileSync(path.join(FIXTURES.posterBasic, 'document.json'), 'utf8'),
    links: fs.readFileSync(path.join(FIXTURES.posterBasic, 'links.json'), 'utf8'),
  };

  const result = await galley.app.evaluate(async ({ BrowserWindow }, { url, files }) => {
    const win = new BrowserWindow({ show: false, width: 1152, height: 1728, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      await win.loadURL(url);
      const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code);
      const loaded = await exec<{ pageId: string; sheet: { width: number; height: number }; sentinels: { key: string; rgb: number[]; model: string; name: string }[] }>(
        `window.galleyExport.load(${JSON.stringify(files)})`,
      );
      const audit = await exec<unknown[]>('window.galleyExport.audit()');
      // what real Chromium computes for every painted element, to catch anything the inline-style audit could not see
      const computed = await exec<{ svg: string[]; text: string[]; paper: number; pageBox: { w: number; h: number }; images: number }>(`(() => {
        const page = document.querySelector('.galley-page');
        const svg = [];
        for (const el of page.querySelectorAll('svg rect, svg ellipse, svg line, svg path')) {
          const cs = getComputedStyle(el);
          for (const v of [cs.fill, cs.stroke]) if (v && v !== 'none') svg.push(v);
        }
        // (a paragraph carries its own color since v2: the frame box has none)
        const text = [...page.querySelectorAll('.galley-text p')].map((el) => getComputedStyle(el).color);
        const box = page.getBoundingClientRect();
        return { svg, text, paper: page.querySelectorAll('.galley-paper').length, pageBox: { w: box.width, h: box.height }, images: page.querySelectorAll('img').length };
      })()`);
      const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1 });
      const head = pdf.subarray(0, 8).toString('latin1');
      const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
      return { loaded, audit, computed, pdf: { bytes: pdf.length, head, mediaBox: mediaBox ? [Number(mediaBox[1]), Number(mediaBox[2])] : null } };
    } finally {
      win.destroy();
    }
  }, { url: exportUrl, files });

  // the sentinel table: black, paper, PANTONE 185 C (spot), Studio Blue, Warm Orange
  expect(result.loaded.sheet).toEqual({ width: 864, height: 1296 });
  expect(result.loaded.sentinels.map((s) => s.key)).toEqual(['black|100|ko', 'paper|100|ko', 'pms-185-c|100|ko', 'studio-blue|100|ko', 'warm-orange|100|ko']);
  expect(result.loaded.sentinels.find((s) => s.key.startsWith('pms-185-c'))).toMatchObject({ model: 'spot', name: 'PANTONE 185 C' });
  const sentinelColors = new Set(result.loaded.sentinels.map((s) => `rgb(${s.rgb.join(', ')})`));
  expect(sentinelColors.size).toBe(5);

  // inline audit: nothing but sentinels
  expect(result.audit).toEqual([]);
  // computed styles in real Chromium: every painted fill, stroke and text color is a sentinel
  expect(result.computed.svg.length).toBeGreaterThanOrEqual(2);
  expect(result.computed.text).toHaveLength(6);
  for (const color of [...result.computed.svg, ...result.computed.text]) expect(sentinelColors, `computed ${color}`).toContain(color);
  expect(result.computed.paper).toBe(0); // no paper fill in export mode
  expect(result.computed.images).toBe(1);
  expect(result.computed.pageBox).toEqual({ w: 864 * (4 / 3), h: 1296 * (4 / 3) });

  // printToPDF smoke check: a PDF whose media box is the sheet (lane A's P1-04 pins down the exact quantization)
  expect(result.pdf.head.startsWith('%PDF-')).toBe(true);
  expect(result.pdf.bytes).toBeGreaterThan(20_000); // includes the 2400 x 1280 photo
  expect(result.pdf.mediaBox, 'found a /MediaBox').not.toBeNull();
  expect(Math.abs(result.pdf.mediaBox![0] - 864)).toBeLessThan(1);
  expect(Math.abs(result.pdf.mediaBox![1] - 1296)).toBeLessThan(1);
});
