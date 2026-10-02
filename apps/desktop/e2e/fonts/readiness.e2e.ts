import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../helpers/fixtures';
import { launchApp } from '../helpers/launch';
import { waitForStable, snap } from '../helpers/screenshot';
import { clickMenuItem, getShellState, stubDialogs } from '../shell/helpers';
import { buildFontFixture } from './fixture';
import type { FontBridge } from '@galley/fonts/types';

test('opening another package waits for its different document font bytes under the same request', async ({ galley }, info) => {
  await galley.close();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-font-readiness-'));
  const first = path.join(temp, 'first.galley'), second = path.join(temp, 'second.galley');
  await buildFontFixture(first); await buildFontFixture(second);
  // Both unmodified OFL sources declare Inter Regular 400 normal, but contain different font tables.
  const replacement = path.join(second, 'fonts/Inter-Regular.woff');
  fs.unlinkSync(path.join(second, 'fonts/Inter-Regular.ttf'));
  fs.copyFileSync(require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff'), replacement);
  expect(fs.readFileSync(replacement)).not.toEqual(fs.readFileSync(path.join(first, 'fonts/Inter-Regular.ttf')));
  const request = { family: 'Inter', weight: 400, style: 'normal' as const };
  const running = await launchApp({ open: first });
  const { page, app } = running;
  try {
    await waitForStable(page);
    const before = await page.evaluate(r => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.resolve([r]), request);
    expect(before[0]!.face.source).toBe('document');
    await page.evaluate(() => {
      const original = window.FontFace;
      (window as any).__fontLoads = [];
      window.FontFace = new Proxy(original, { construct(target, args) {
        const face = Reflect.construct(target, args);
        (window as any).__fontLoads.push({ family: args[0], source: args[1], face });
        return face;
      } });
    });
    // Hold inventory completion rather than relying on machine timing to expose the stale-ready interval.
    await app.evaluate(({ ipcMain }) => {
      const hook = (globalThis as any).__galleyFonts;
      (globalThis as any).__pendingInventory = [];
      ipcMain.removeHandler('galley:font-families');
      ipcMain.handle('galley:font-families', () => new Promise(resolve => {
        (globalThis as any).__pendingInventory.push(() => resolve(hook.fontFamilies()));
      }));
    });
    await stubDialogs(app, { open: [second] });
    await clickMenuItem(app, 'file.open');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(second);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__pendingInventory.length)).toBeGreaterThan(0);
    let stableFinished = false;
    const stability = waitForStable(page).then(() => { stableFinished = true; });
    // This is a bounded opportunity for the real waitForStable helper to return while inventory is held.
    await page.waitForTimeout(150);
    const prematurelyReady = stableFinished;
    const advertisedReady = await page.locator('.galley-page').getAttribute('data-ready');
    // Release every queued request and restore normal IPC before asserting, so cleanup never strands the app.
    await app.evaluate(({ ipcMain }) => {
      const hook = (globalThis as any).__galleyFonts;
      ipcMain.removeHandler('galley:font-families');
      ipcMain.handle('galley:font-families', () => hook.fontFamilies());
      for (const resolve of (globalThis as any).__pendingInventory) resolve();
    });
    await stability;
    await waitForStable(page);
    expect(prematurelyReady, 'waitForStable must stay pending while the new package fonts are unresolved').toBe(false);
    expect(advertisedReady).toBe('false');
    const after = await page.evaluate(r => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.resolve([r]), request);
    expect(after[0]!.face.path).toBe(replacement);
    expect(after[0]!.url).not.toBe(before[0]!.url);
    const loaded = await page.evaluate(() => (window as any).__fontLoads.filter((entry: any) => entry.family === 'Inter').map((entry: any) => ({ source: entry.source, status: entry.face.status })));
    expect(loaded).toEqual([{ source: `url(${JSON.stringify(after[0]!.url)})`, status: 'loaded' }]);
    const bytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], after[0]!.url);
    expect(Buffer.from(bytes)).toEqual(fs.readFileSync(replacement));
    await snap(page, 'document-font-package-switch', { testInfo: info });
  } finally { await running.close(); }
});
