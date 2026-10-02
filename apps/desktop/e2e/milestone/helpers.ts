import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dragPage, flushInput, getDoc, type DragOptions, type Pt } from '../canvas/helpers';
import { getEditorState } from '../helpers/app-state';
import { APP_DIR, REPO_ROOT } from '../helpers/launch';
import { waitForStable } from '../helpers/screenshot';
import { diffPngs } from '../shell/helpers';

// Helpers for the milestone-1 journey. Everything here drives the UI the way a person does (keys, clicks, drags, typing in
// fields); the model is only read, to assert on what the gestures did.

/** Where the journey's inspection screenshots go (gitignored, like the rest of test-results/). */
export const SHOTS_DIR = path.join(APP_DIR, 'test-results', 'milestone1');

/** The PATH the command-line tools (Ghostscript, qpdf, poppler) are found on. */
export const TOOL_ENV = { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` };

/** Fail fast, with the install line, when a command-line tool the PDF checks need is missing. */
export function requireTools(): void {
  for (const tool of ['gs', 'qpdf', 'pdfinfo', 'pdftoppm']) {
    const r = spawnSync(tool, ['-v'], { env: TOOL_ENV });
    if (r.error) throw new Error(`${tool} is required for the PDF checks (brew install ghostscript qpdf poppler)`);
  }
}

export function resetShots(): void {
  fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

/** A screenshot of the whole window (or of one element) for a person to look at: SHOTS_DIR/<name>.png at 1 CSS pixel per pixel. */
export async function shot(page: Page, name: string, target: Page | Locator = page): Promise<string> {
  await waitForStable(page);
  await page.mouse.move(2, 2); // out of the way: no hover state in the picture
  await flushInput(page);
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await target.screenshot({ path: file, scale: 'css', animations: 'disabled', caret: 'hide' });
  return file;
}

/**
 * A screenshot taken by the window itself (`webContents.capturePage`), for the moment a pointer button is held down. Playwright's
 * `page.screenshot` resizes the page for the capture, and Chromium answers with a synthetic pointer move that drags the gesture
 * in progress somewhere else; the window's own capture leaves the page alone.
 */
export async function shotWhileDragging(app: ElectronApplication, page: Page, name: string): Promise<string> {
  await flushInput(page);
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  // the capture is at the display's native resolution; bring it to 1 CSS pixel per pixel like the other screenshots
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await sharp(Buffer.from(base64, 'base64')).resize(size.width, size.height).png().toFile(file);
  return file;
}

// ------------------------------------------------------------------------------------------------------ the photo

/**
 * The poster's photo: a landscape made entirely by this function (a sky, a sun, two hills, seeded grain), 3000 x 1700 px
 * tagged 300 ppi. Nothing third-party. At 1.76:1 it is a little taller than the 720 x 384 pt frame it goes into, so
 * Fill Frame Proportionally has something to crop.
 */
export async function generatePhoto(file: string): Promise<void> {
  const W = 3000;
  const H = 1700;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 300 170">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f7fc4"/><stop offset="0.7" stop-color="#8fb3e0"/><stop offset="1" stop-color="#cfe0f3"/></linearGradient>
      <linearGradient id="red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2303a"/><stop offset="1" stop-color="#8f1d27"/></linearGradient>
      <linearGradient id="green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8244"/><stop offset="1" stop-color="#245428"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#sky)"/>
    <circle cx="224" cy="60" r="23" fill="#f6d27a"/>
    <path d="M0 108 C 50 82, 110 82, 170 104 S 260 118, 300 98 L300 170 L0 170 Z" fill="url(#red)"/>
    <path d="M0 134 C 60 112, 120 118, 180 134 S 260 142, 300 128 L300 170 L0 170 Z" fill="url(#green)"/>
  </svg>`;
  // seeded grain, so the image is not flat gradients (a photograph is never banded) and is the same every run
  let a = 0x2f6e2b1;
  const noise = Buffer.alloc(W * H * 3);
  for (let i = 0; i < noise.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    noise[i] = 118 + ((((t ^ (t >>> 14)) >>> 0) % 21) | 0);
  }
  const grain = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  await sharp(Buffer.from(svg))
    .composite([{ input: grain, blend: 'soft-light' }])
    .withMetadata({ density: 300 })
    .jpeg({ quality: 90 })
    .toFile(file);
}

// --------------------------------------------------------------------------------------------------- driving the UI

/** Click a tool in the Tools column (the same path as its shortcut and its menu item). */
export async function chooseTool(page: Page, tool: 'select' | 'type' | 'rectangle' | 'rectangle-frame' | 'ellipse'): Promise<void> {
  await page.locator(`button[data-tool="${tool}"]`).click();
  expect((await getEditorState(page)).activeTool).toBe(tool);
}

export interface GeometryEdit {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** Type values into the control strip's X, Y, W and H fields (reference point top-left), each committed with Enter: one undo step per field. */
export async function setGeometry(page: Page, edit: GeometryEdit): Promise<void> {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = edit[key];
    if (value === undefined) continue;
    const field = page.locator(`[data-testid="control-strip-fields"] [data-field="${key}"]`);
    await expect(field).toBeEnabled();
    await field.fill(`${value} pt`);
    await field.press('Enter');
  }
  await flushInput(page);
}

/** The id of the one selected frame. */
export async function selectedFrameId(page: Page): Promise<string> {
  const { selection } = await getEditorState(page);
  expect(selection, 'exactly one frame is selected').toHaveLength(1);
  return selection[0]!;
}

export interface DrawnFrame {
  id: string;
  frame: any;
}

/** Choose a tool and drag with it between two page points. The new frame is selected afterwards; returns it. */
export async function drawWith(page: Page, tool: 'type' | 'rectangle' | 'rectangle-frame' | 'ellipse', from: Pt, to: Pt, options: DragOptions = {}): Promise<DrawnFrame> {
  const before = new Set(Object.keys((await getDoc(page)).frames));
  await chooseTool(page, tool);
  await dragPage(page, from, to, options);
  if (options.hold) return { id: '', frame: null };
  const doc = await getDoc(page);
  const added = Object.keys(doc.frames).filter((id) => !before.has(id));
  expect(added, `the ${tool} drag added one frame`).toHaveLength(1);
  expect(await selectedFrameId(page)).toBe(added[0]);
  return { id: added[0]!, frame: doc.frames[added[0]!] };
}

/** All the text of a story, paragraphs joined with a newline: walks the story's ProseMirror JSON, whatever its schema version. */
export function storyText(doc: any, storyId: string): string {
  const walk = (n: any): string => (typeof n.text === 'string' ? n.text : (n.content ?? []).map(walk).join(n.type === 'doc' ? '\n' : ''));
  return walk(doc.stories[storyId].doc);
}

/** Type a story into the text frame that was just drawn (the Type tool leaves its caret in it), then leave editing with Escape. */
export async function typeInto(page: Page, frameId: string, text: string): Promise<void> {
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute('data-editing-frame', frameId);
  await page.keyboard.type(text);
  await expect.poll(async () => {
    const doc = await getDoc(page);
    return storyText(doc, doc.frames[frameId].storyId);
  }).toBe(text);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  expect((await getEditorState(page)).selection).toEqual([frameId]); // the frame stays selected
}

/** A row of the Swatches panel, by its name. */
export const swatchRow = (page: Page, name: string) => page.locator('[data-panel="swatches"] .gl-swatch-row').filter({ has: page.locator('.gl-swatch-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

export interface NewSwatch {
  name: string;
  kind: 'cmyk' | 'spot';
  values: [number, number, number, number];
}

/** New Swatch… from the panel's footer button: name, color type and the four channel fields. */
export async function makeSwatch(page: Page, swatch: NewSwatch): Promise<void> {
  await page.getByTestId('swatches-new').click();
  const dialog = page.getByTestId('swatch-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-field="name"]').fill(swatch.name);
  await dialog.locator('[data-field="type"]').selectOption(swatch.kind);
  for (const [i, channel] of (['c', 'm', 'y', 'k'] as const).entries()) {
    await dialog.locator(`[data-field="${channel}"]`).fill(String(swatch.values[i]));
    await page.keyboard.press('Tab');
    await expect(dialog.locator(`[data-slider="${channel}"]`)).toHaveValue(String(swatch.values[i]));
  }
  await dialog.getByTestId('dialog-ok').click();
  await expect(dialog).toHaveCount(0);
  await expect(swatchRow(page, swatch.name)).toHaveCount(1);
}

/** Apply a swatch from the Swatches panel to the fill of the selected frame (the proxy's fill is the target). */
export async function paintFill(page: Page, swatchName: string): Promise<void> {
  await page.locator('[data-proxy="fill"]').click();
  await swatchRow(page, swatchName).click();
}

/** Set the selected frame's stroke to [None] (a new shape starts with a 1 pt black stroke, as in InDesign), then point the proxy back at the fill. */
export async function clearStroke(page: Page): Promise<void> {
  await page.locator('[data-proxy="stroke"]').click();
  await page.locator('[data-panel="swatches"] [data-swatch-id="none"]').click();
  await page.locator('[data-proxy="fill"]').click();
}

export const near = (actual: number, expected: number, tolerance: number) => Math.abs(actual - expected) <= tolerance;

// ------------------------------------------------------------------------------------------------------ the PDF

export interface PosterChecks {
  checks: { group: string; name: string; expected: string; measured: string; pass: boolean }[];
  measurements: {
    plateNames: string[];
    patches: { frame: string; swatch: string; model: 'cmyk' | 'spot'; expected: { C: number; M: number; Y: number; K: number; spots: Record<string, number> }; measured: { C: number; M: number; Y: number; K: number; spots: Record<string, number> }; pass: boolean }[];
    texts: { frame: string; text: string; max: { C: number; M: number; Y: number; K: number; spots: Record<string, number> }; pass: boolean }[];
    boxes: unknown;
  };
}

/**
 * Run scripts/milestone1/check-poster.ts (under tsx; the spec cannot import the ESM workspace packages itself): the golden
 * suite plus the poster's own plate measurements. Returns what it printed.
 */
export function measurePoster(pdf: string, pkgDir: string, workDir: string, plateDir: string): PosterChecks {
  const tsx = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
  const r = spawnSync(tsx, [path.join(REPO_ROOT, 'scripts/milestone1/check-poster.ts'), pdf, pkgDir, workDir, plateDir], { encoding: 'utf8', maxBuffer: 128 << 20, env: TOOL_ENV });
  const line = r.stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(line) as PosterChecks;
  } catch {
    throw new Error(`The poster checks did not run (exit ${r.status}):\n${r.stdout.slice(-2000)}\n${r.stderr}`);
  }
}

/** `pdfinfo -box`: the named page box as numbers. */
export function pdfBox(pdf: string, name: 'MediaBox' | 'TrimBox' | 'BleedBox' | 'CropBox' | 'ArtBox'): number[] {
  const out = spawnSync('pdfinfo', ['-box', pdf], { encoding: 'utf8', env: TOOL_ENV }).stdout;
  const m = new RegExp(`^${name}:\\s+(.*)$`, 'm').exec(out);
  if (!m) throw new Error(`pdfinfo shows no ${name}`);
  return m[1]!.trim().split(/\s+/).map(Number);
}

/** `qpdf --check`: its exit status and what it said. */
export function qpdfCheck(pdf: string): { ok: boolean; output: string } {
  const r = spawnSync('qpdf', ['--check', pdf], { encoding: 'utf8', env: TOOL_ENV });
  const output = `${r.stdout}${r.stderr}`;
  return { ok: r.status === 0 && /No syntax or stream encoding errors/.test(output), output };
}

/** Render page 1 of the PDF to a PNG with `pdftoppm` at `dpi`. Returns the file. */
export function renderPdf(pdf: string, name: string, dpi = 75): string {
  const base = path.join(SHOTS_DIR, name);
  const r = spawnSync('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', pdf, base], { encoding: 'utf8', env: TOOL_ENV });
  if (r.status !== 0) throw new Error(`pdftoppm failed: ${r.stderr}`);
  return `${base}.png`;
}

// ---------------------------------------------------------------------------------------------------------- pixels

/**
 * The page as pixels, once it has stopped changing: opening a package changes its image URLs, so the picture reloads after
 * the document is swapped. Take shots until two in a row are identical (and every image has loaded).
 */
export async function settledPageShot(page: Page): Promise<Buffer> {
  await waitForStable(page);
  await expect
    .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.galley-page img')).every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
  await page.mouse.move(2, 2);
  await flushInput(page);
  let previous = await page.locator('.galley-page').screenshot();
  let last = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const next = await page.locator('.galley-page').screenshot();
    // "stopped changing" means no pixel moved by more than resampling noise (Chromium does not always scale a large photo the same way twice)
    const diff = await diffPngs(previous, next);
    if (diff.significant === 0) return next;
    last = JSON.stringify(diff);
    previous = next;
  }
  throw new Error(`the page never stopped changing (last difference ${last})`);
}
