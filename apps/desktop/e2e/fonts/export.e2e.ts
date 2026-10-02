import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { test, expect } from '../helpers/fixtures';
import { launchApp, REPO_ROOT } from '../helpers/launch';
import { snap, waitForStable } from '../helpers/screenshot';
import { pdfLines, stubSaveDialog } from '../export/pdf';
import { buildFontFixture } from './fixture';
import type { FontBridge, FontBinding } from '@galley/fonts/types';

test('static TTF, variable instance and CFF export report, exact lines and K-only RIP plates', async ({ galley }, testInfo) => {
  test.setTimeout(120_000);
  const families = await galley.page.evaluate(() => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.families());
  const cff = families.flatMap((f) => f.faces).find((f) => f.format === 'cff' && !f.family.startsWith('.') && f.embeddable && f.style === 'normal' && /\.otf$/i.test(f.path));
  test.skip(!cff, 'No installed embeddable CFF .otf font found; system/proprietary fonts are never committed.');
  await galley.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-font-export-'));
  const pkg = path.join(dir, 'fonts.galley'); await buildFontFixture(pkg, cff);
  const app = await launchApp({ open: pkg });
  try {
    const { page } = app; const out = path.join(dir, 'fonts.pdf');
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('RENDERER:', msg.text()); });
    page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
    const probe = await page.evaluate(async (r) => {
      const bridge = (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts;
      const b = await bridge.resolve([{ family: r.family, weight: r.weight, style: r.style }]);
      try { await new FontFace('Galley Probe', `url(${JSON.stringify(b[0]!.url)})`).load(); return { ok: true, path: b[0]!.face.path }; } catch (e) { return { ok: false, error: String(e), path: b[0]!.face.path }; }
    }, cff!);
    console.log('CFF probe:', probe); expect(probe.ok).toBe(true);
    await waitForStable(page);
    const bindings = await page.evaluate(() => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.resolve([{ family: 'Inter', weight: 400, style: 'normal' }, { family: 'Roboto', weight: 650, style: 'normal' }]));
    expect(bindings.every((b) => b.face.source === 'document')).toBe(true);
    expect(bindings[1]!.instanceAxes).toEqual({ wght: 650 });
    const screenWords = await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>('.galley-page')!;
      const box = sheet.getBoundingClientRect(), scale = box.width / parseFloat(getComputedStyle(sheet).width);
      const result: { frame: string; text: string; x: number; y: number; end: number }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.galley-text')) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          for (const match of n.data.matchAll(/\S+/g)) {
            const range = document.createRange(); range.setStart(n, match.index!); range.setEnd(n, match.index! + match[0].length);
            const r = range.getBoundingClientRect();
            result.push({ frame: el.dataset.frameId!, text: match[0], x: (r.left - box.left) / scale * 0.75, y: (r.top - box.top) / scale * 0.75, end: (r.right - box.left) / scale * 0.75 });
          }
        }
      }
      return result;
    });
    const screen: Record<string, { text: string; top: number }[]> = {};
    for (const word of screenWords) {
      const lines = screen[word.frame] ??= [];
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - word.y) < 0.5) last.text += ` ${word.text}`;
      else lines.push({ text: word.text, top: word.y });
    }
    await stubSaveDialog(app.app, { filePath: out });
    await page.keyboard.press('Meta+e');
    await expect(page.getByTestId('export-font-warnings')).toContainText(cff!.family);
    await expect(page.getByTestId('export-font-warnings')).toContainText('Type 3');
    await snap(page, 'font-export-cff-warning', { testInfo });
    await page.getByTestId('export-marks').uncheck();
    await page.getByTestId('export-run').click();
    await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('export-font-report').locator('summary').click();
    await expect(page.getByTestId('export-font-report')).toContainText('Roboto 650 normal: static TrueType instance');
    await expect(page.getByTestId('export-font-report')).toContainText(cff!.family);
    await snap(page, 'font-export-report', { testInfo });
    const fontRows = spawnSync('pdffonts', [out], { encoding: 'utf8' }).stdout;
    console.log(`PDF: ${out}\n${fontRows}`);
    expect(fontRows).toMatch(/Inter[^\n]*CID TrueType/);
    expect(fontRows).toMatch(/Roboto[^\n]*CID TrueType/);
    expect(fontRows).toMatch(/Type 3/);
    for (let row = 0; row < 2; row++) {
      const lines = screen[`font-${row}`]!;
      const printed = pdfLines(out, { x0: 36, y0: 36 + row * 200, x1: 456, y1: 206 + row * 200 });
      expect(printed.map((l) => l.text)).toEqual(lines.map((l) => l.text));
      for (let i = 1; i < lines.length; i++) expect(Math.abs((printed[i]!.top - printed[0]!.top) - (lines[i]!.top - lines[0]!.top))).toBeLessThanOrEqual(0.05);
    }
    const xml = spawnSync('pdftotext', ['-bbox', out, '-'], { encoding: 'utf8' }).stdout;
    const printedWords = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), end: Number(m[3]), text: m[5]! }));
    let largest = 0;
    for (let row = 0; row < 2; row++) {
      const screenRow = screenWords.filter((w) => w.frame === `font-${row}`);
      const printedRow = printedWords.filter((w) => w.y >= 36 + row * 200 && w.y < 206 + row * 200);
      expect(printedRow.map((w) => w.text)).toEqual(screenRow.map((w) => w.text));
      for (let i = 0; i < screenRow.length; i++) {
        const a = screenRow[i]!, b = printedRow[i]!;
        const error = Math.max(Math.abs(a.x - b.x), Math.abs(a.end - b.end), Math.abs((a.y - screenRow[0]!.y) - (b.y - printedRow[0]!.y)));
        largest = Math.max(largest, error);
        expect(error, `${a.text} screen/PDF advance and line-position error`).toBeLessThanOrEqual(0.05);
      }
    }
    console.log(`Static/variable word-position maximum error: ${largest.toFixed(6)} pt; line mismatches: 0`);
    const rip = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), [path.join(__dirname, 'check-export.ts'), out, path.join(dir, 'plates'), '3'], { encoding: 'utf8' });
    console.log(rip.stdout);
    expect(rip.status, rip.stderr).toBe(0);
    // The export API resolves identical instance capability URLs, not a fresh substitute font.
    const exported = await app.app.evaluate(async (_electron, requests) => (globalThis as unknown as { __galleyFonts: { resolveFonts(r: unknown, exp: boolean): Promise<FontBinding[]> } }).__galleyFonts.resolveFonts(requests, true), [{ family: 'Inter', weight: 400, style: 'normal' }, { family: 'Roboto', weight: 650, style: 'normal' }]);
    expect(exported.map((b) => b.url)).toEqual(bindings.map((b) => b.url));
  } finally { await app.close(); }
});

test('restricted document font renders on screen but export refuses embedding', async ({ galley }) => {
  await galley.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-restricted-font-'));
  const pkg = path.join(dir, 'restricted.galley'); await buildFontFixture(pkg);
  const font = path.join(pkg, 'fonts/Inter-Regular.ttf'); const bytes = fs.readFileSync(font);
  for (let table = 0; table < bytes.readUInt16BE(4); table++) {
    const at = 12 + table * 16;
    if (bytes.toString('ascii', at, at + 4) === 'OS/2') bytes.writeUInt16BE(2, bytes.readUInt32BE(at + 8) + 8);
  }
  fs.writeFileSync(font, bytes);
  const app = await launchApp({ open: pkg });
  try {
    const out = path.join(dir, 'restricted.pdf');
    await waitForStable(app.page);
    await stubSaveDialog(app.app, { filePath: out });
    await app.page.keyboard.press('Meta+e');
    await expect(app.page.getByTestId('export-font-warnings')).toContainText('Restricted license embedding');
    await app.page.getByTestId('export-run').click();
    await expect(app.page.getByTestId('export-error')).toContainText('Cannot export Inter Regular: Restricted license embedding');
    expect(fs.existsSync(out)).toBe(false);
  } finally { await app.close(); }
});
