// Helpers for the export e2e specs (lane A): stubbing the save dialog, and measuring an exported PDF with the golden checks.
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/launch';

export interface GoldenCheck {
  group: string;
  name: string;
  expected: string;
  measured: string;
  pass: boolean;
}

/** A scratch folder for one test's PDFs and plates. */
export function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'galley-export-e2e-'));
}

/** Make the next Save dialog answer with this path (or a cancel), without showing anything. Runs in the main process. */
export async function stubSaveDialog(app: ElectronApplication, answer: { filePath: string } | { canceled: true }): Promise<void> {
  await app.evaluate(({ dialog }, a) => {
    (dialog as unknown as { showSaveDialog: (...args: unknown[]) => Promise<unknown> }).showSaveDialog = async () => ('canceled' in a ? { canceled: true, filePath: '' } : { canceled: false, filePath: a.filePath });
  }, answer);
}

/** Run the golden checks (scripts/golden/check-pdf.ts, under tsx) on an exported PDF of a `.galley` package. */
export function goldenChecks(pdf: string, pkgDir: string, options: { bleed: boolean; marks: boolean }, workDir: string): GoldenCheck[] {
  const tsx = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
  const r = spawnSync(tsx, [path.join(REPO_ROOT, 'scripts/golden/check-pdf.ts'), pdf, pkgDir, options.bleed ? 'on' : 'off', options.marks ? 'on' : 'off', workDir], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const line = r.stdout.trim().split('\n').pop() ?? '';
  try {
    return (JSON.parse(line) as { checks: GoldenCheck[] }).checks;
  } catch {
    throw new Error(`The golden checks did not run (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
}

/** `pdfinfo -box`: the named page box as numbers. */
export function pdfBox(pdf: string, name: 'MediaBox' | 'TrimBox' | 'BleedBox'): number[] {
  const out = spawnSync('pdfinfo', ['-box', pdf], { encoding: 'utf8' }).stdout;
  const m = new RegExp(`^${name}:\\s+(.*)$`, 'm').exec(out);
  if (!m) throw new Error(`pdfinfo shows no ${name}`);
  return m[1]!.trim().split(/\s+/).map(Number);
}

export const failures = (checks: readonly GoldenCheck[]) => checks.filter((c) => !c.pass).map((c) => `[${c.group}] ${c.name}: expected ${c.expected}, measured ${c.measured}`);

/** What the editor's preload bridge answers for CMYK inks (percentages): the display sRGB through the output profile, or null. */
export async function softProofViaIpc(page: Page, inks: [number, number, number, number][]): Promise<[number, number, number][] | null> {
  return page.evaluate((i) => (window as unknown as { galley: { press: { softProof(i: unknown): Promise<[number, number, number][] | null> } } }).galley.press.softProof(i), inks);
}

export interface TextLine {
  text: string;
  /** Distance of the line's top from the frame's top, in points (on screen: the character boxes; in the PDF: the word boxes). */
  top: number;
}

/** The lines the editor's DOM laid out, per text frame: every character's box, grouped into lines by its top. */
export async function domLines(page: Page): Promise<Record<string, TextLine[]>> {
  return page.evaluate(() => {
    const result: Record<string, { text: string; top: number }[]> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.galley-page .galley-text'))) {
      const box = el.getBoundingClientRect();
      const scale = box.height / el.offsetHeight; // the canvas scales the page: layout px to screen px
      const chars: { ch: string; top: number }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        for (let i = 0; i < n.data.length; i++) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const rects = r.getClientRects();
          if (rects.length === 0) continue;
          chars.push({ ch: n.data[i]!, top: ((rects[rects.length - 1]!.top - box.top) / scale) * 0.75 });
        }
      }
      const lines: { text: string; top: number }[] = [];
      for (const c of chars) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.top - c.top) < 1.5) last.text += c.ch;
        else lines.push({ text: c.ch, top: c.top });
      }
      result[el.getAttribute('data-frame-id')!] = lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), top: l.top }));
    }
    return result;
  });
}

/** The lines of a PDF inside a rectangle (points from the top-left of the page), from `pdftotext -bbox`: words grouped by their top. */
export function pdfLines(pdf: string, rect: { x0: number; y0: number; x1: number; y1: number }): TextLine[] {
  const xml = spawnSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout;
  const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map((m) => ({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, text: m[5]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }))
    .filter((w) => (w.x0 + w.x1) / 2 >= rect.x0 && (w.x0 + w.x1) / 2 <= rect.x1 && (w.y0 + w.y1) / 2 >= rect.y0 && (w.y0 + w.y1) / 2 <= rect.y1);
  const lines: { y: number; words: typeof words }[] = [];
  for (const w of words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - w.y0) < 1.5) last.words.push(w);
    else lines.push({ y: w.y0, words: [w] });
  }
  return lines.map((l) => ({ text: l.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' '), top: l.y - rect.y0 }));
}
