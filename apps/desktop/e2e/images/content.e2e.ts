import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState, runCommand } from '../helpers/app-state';
import { getDoc, loadDoc } from '../canvas/helpers';
import { clickMenuItem, dispatchModel, getFrame, stubDialogs } from '../shell/helpers';
import { snap } from '../helpers/screenshot';

test.use({ open: null });
test('content fields preserve the rotated frame, undo once, reopen and print the same crop', async ({ galley }, testInfo) => {
  const { page, app } = galley;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-content-'));
  const image = path.join(dir, 'halves.png');
  await sharp({ create: { width: 400, height: 200, channels: 3, background: '#fff' } })
    .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } }).png().toBuffer(), left: 0, top: 0 }]).png().toFile(image);
  await loadDoc(page);
  await stubDialogs(app, { open: [image] });
  await page.keyboard.press('Meta+d');
  await expect.poll(async () => (await getEditorState(page)).selection.length).toBe(1);
  const id = (await getEditorState(page)).selection[0]!;
  await dispatchModel(page, 'setFrameProps', { ids: [id], props: { x: 120, y: 140, w: 160, h: 100, rotation: 30, content: { x: 0, y: 0, w: 160, h: 80 } } });
  await clickMenuItem(app, 'window.imageContent');
  const panel = page.locator('[data-panel="imageContent"]');
  await expect(panel).toBeVisible();
  const field = (axis: string) => panel.locator(`[data-field="content-${axis}"]`);
  const edit = async (axis: string, value: string) => { await field(axis).fill(value); await field(axis).press('Enter'); };
  await edit('w', '240 pt');
  expect((await getFrame(page, id)).content).toEqual({ x: 0, y: 0, w: 240, h: 120 });
  await panel.getByTestId('content-proportions').uncheck();
  await edit('h', '180 pt');
  await edit('x', '-40 pt');
  const before = await getDocumentJson(page);
  const steps = (await getEditorState(page)).undoSteps;
  await edit('y', '-20 pt');
  expect((await getEditorState(page)).undoSteps).toBe(steps + 1);
  await page.keyboard.press('Meta+z');
  expect(await getDocumentJson(page)).toBe(before);
  await page.keyboard.press('Meta+Shift+z');
  const finalFrame = await getFrame(page, id);
  expect(finalFrame).toMatchObject({ x: 120, y: 140, w: 160, h: 100, rotation: 30, content: { x: -40, y: -20, w: 240, h: 180 } });
  for (const invalid of ['0', '-10', 'NaN', 'Infinity', 'oops']) {
    await edit('w', invalid);
    expect(await getFrame(page, id)).toEqual(finalFrame);
  }
  await snap(page, 'phase3-image-content', { testInfo });
  // Real panel fitting actions remain a single undoable change.
  for (const mode of ['fillProportionally', 'fitProportionally', 'contentToFrame', 'center']) {
    await panel.getByLabel('Image content fitting').selectOption(mode);
    await page.keyboard.press('Meta+z');
    expect(await getFrame(page, id)).toEqual(finalFrame);
  }
  const saved = path.join(dir, 'crop.galley');
  await stubDialogs(app, { save: [saved] });
  await runCommand(page, 'file.saveAs');
  await stubDialogs(app, { open: [saved] });
  await runCommand(page, 'file.open');
  expect((await getDoc(page)).frames[id]).toEqual(finalFrame);
  // Independent PDF raster: compute the rotated frame coordinates from the model,
  // then find the black/white boundary at x = content.x + content.w / 2 = 80 pt.
  const pdf = path.join(dir, 'crop.pdf');
  const files = await page.evaluate(() => { const g = (window as any).__galley; return g.model.serializeDocument(g.store.getState().history.doc); });
  await app.evaluate(async (_electron, { files, pdf }) => (globalThis as any).__galleyExport.runToFile({ files, options: { bleed: false, marks: false } }, pdf), { files, pdf });
  const prefix = path.join(dir, 'crop-render');
  const result = spawnSync('pdftoppm', ['-r', '144', '-png', '-singlefile', pdf, prefix], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const raster = await sharp(prefix + '.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const gray = (x: number, y: number) => {
    const theta = Math.PI / 6;
    const px = Math.round(2 * (200 + (x - 80) * Math.cos(theta) - (y - 50) * Math.sin(theta)));
    const py = Math.round(2 * (190 + (x - 80) * Math.sin(theta) + (y - 50) * Math.cos(theta)));
    const i = (py * raster.info.width + px) * raster.info.channels;
    return (raster.data[i]! + raster.data[i + 1]! + raster.data[i + 2]!) / 3;
  };
  expect(gray(20, 50)).toBeLessThan(50);
  expect(gray(140, 50)).toBeGreaterThan(240);
  expect(gray(-10, 50)).toBeGreaterThan(240); // clipped at enclosing frame
  const boundary = Array.from({ length: 100 }, (_, i) => i + 30).find((x) => gray(x, 50) > 150)!;
  expect(Math.abs(boundary - 80)).toBeLessThanOrEqual(1);
});
