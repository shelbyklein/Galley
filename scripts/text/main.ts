// Electron main process. `--demo`: visible window for hands-on typing. `--test`: hidden window driven by Playwright.
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { compareLines, pdfLinesBySlot, pdfWords } from './pdfcheck';

const root = path.resolve(__dirname, '..');
const demo = process.argv.includes('--demo');
let win: BrowserWindow | null = null;

export async function printToPdf(w: BrowserWindow = win!): Promise<Buffer> {
  // exactly the options the press spike settled on
  return w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1, generateTaggedPDF: false, generateDocumentOutline: false });
}

async function exportAndCheck(domLines: any[][], slots: { x: number; y: number; w: number; h: number }[]) {
  const pdf = await printToPdf();
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'threading-demo.pdf');
  fs.writeFileSync(file, pdf);
  const pdfLines = pdfLinesBySlot(pdfWords(file), slots);
  const c = compareLines(domLines, pdfLines);
  return { ok: c.ok, lines: c.domLines, slots: domLines.length, mismatches: c.mismatches, detail: c.details.slice(0, 3).join(' | '), file: path.relative(root, file) };
}

async function create() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    show: demo,
    width: demo ? Math.min(1000, wa.width) : 1100,
    height: demo ? Math.min(1180, wa.height) : 1300,
    title: 'Galley threading spike',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  });
  await win.loadFile(path.join(root, 'page', 'index.html'), { query: { mode: demo ? 'demo' : 'test' } });
}

(globalThis as any).galleyMain = { printToPdf: async () => (await printToPdf()).toString('base64'), version: () => ({ electron: process.versions.electron, chrome: process.versions.chrome }), getWindow: () => win };

app.whenReady().then(() => {
  ipcMain.handle('export-check', (_e, lines, slots) => exportAndCheck(lines, slots));
  return create();
});
app.on('window-all-closed', () => app.quit());
