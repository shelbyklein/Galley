import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareLines, pdfFonts, pdfInfo, pdfLinesBySlot, pdfWords, type Compare, type LineLike, type PdfWord } from '../pdfcheck';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'out');

export interface App {
  app: ElectronApplication;
  page: Page;
  close(): Promise<void>;
}

export async function launch(): Promise<App> {
  fs.mkdirSync(outDir, { recursive: true });
  const app = await _electron.launch({ executablePath: electronPath as unknown as string, args: [path.join(root, 'build/main.cjs'), '--test'] });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  return { app, page, close: () => app.close() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type G = any;

export async function printPdf(a: App, name: string): Promise<string> {
  const b64 = await a.app.evaluate(() => (globalThis as any).galleyMain.printToPdf() as Promise<string>);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

export interface PdfMatch extends Compare {
  file: string;
  pages: number;
  width: number;
  height: number;
  domLinesBySlot: LineLike[][];
  pdfLinesBySlot: LineLike[][];
  words: PdfWord[];
  slotRects: { x: number; y: number; w: number; h: number }[];
}

/** Print the live page and compare, line by line, with the lines currently on screen. */
export async function pdfMatch(a: App, name: string): Promise<PdfMatch> {
  const dom = await a.page.evaluate(() => (window as any).galley.lines());
  const slots = await a.page.evaluate(() => (window as any).galley.app.slots as { x: number; y: number; w: number; h: number }[]);
  const file = await printPdf(a, name);
  const words = pdfWords(file);
  const pdf = pdfLinesBySlot(words, slots);
  const c = compareLines(dom, pdf);
  const info = pdfInfo(file);
  return { ...c, file, pages: info.pages, width: info.width, height: info.height, domLinesBySlot: dom, pdfLinesBySlot: pdf, words, slotRects: slots };
}

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'galley-'));

export function stats(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
  const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return { n: a.length, mean, median: q(50), p95: q(95), p99: q(99), max: s[s.length - 1] ?? 0 };
}

/** Let PM process the async selectionchange / pending DOM mutations before reading editor state. */
export const settle = (p: Page, ms = 40) => p.evaluate((t) => new Promise<void>((r) => setTimeout(r, t)), ms);

export const G = (a: App) => ({
  call: <T = any>(name: string, ...args: any[]) =>
    a.page.evaluate(([n, ar]) => (window as any).galley[n](...(ar as any[])), [name, args] as [string, any[]]) as Promise<T>,
});

/** Frame list for sweeps: three single-column frames and a 2-col frame, widths varied. Coordinates are multiples of 3pt. */
export function sweepFrames(w1: number, w2: number, h1 = 156) {
  return [
    { id: 'A', x: 54, y: 54, w: w1, h: h1 },
    { id: 'B', x: 54, y: 228, w: w2, h: 288 },
    { id: 'C', x: 54, y: 534, w: 504, h: 222, cols: 2, gutter: 18 },
  ];
}

/** story position (inside a paragraph) -> offset in storyText (paragraphs joined by "\n") */
export function posToOffset(paras: string[], pos: number): number {
  let acc = 1;
  let off = 0;
  for (const p of paras) {
    if (pos <= acc + p.length) return off + (pos - acc);
    acc += p.length + 2;
    off += p.length + 1;
  }
  throw new Error('pos out of range ' + pos);
}

export { pdfFonts };
