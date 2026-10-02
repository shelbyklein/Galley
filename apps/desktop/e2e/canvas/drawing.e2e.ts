import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState, runCommand } from '../helpers/app-state';
import { FIXTURES } from '../helpers/launch';
import { expectBaseline, snap } from '../helpers/screenshot';
import { clickPage, dragPage, flushInput, getDoc, getFrame, loadDoc, setSelection, setTool } from './helpers';

// P1-10: drawing and placing tools: rectangle (M), ellipse (L), line (\), rectangle frame (F), text frame (T, then type)
// and place image (⌘D) with the fitting options.

test.use({ open: null });

const undoSteps = async (page: Page) => (await getEditorState(page)).undoSteps;
const selection = async (page: Page) => (await getEditorState(page)).selection;

/** Draw with a tool and check the drag is exactly one undo step that ⌘Z takes back byte for byte. Returns the new frame. */
async function draw(page: Page, tool: string, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: ('Shift' | 'Alt')[] = []) {
  const before = await getDocumentJson(page);
  const steps = await undoSteps(page);
  await setTool(page, tool);
  await dragPage(page, from, to, { modifiers });
  expect(await undoSteps(page)).toBe(steps + 1);
  const [id] = await selection(page);
  expect(id).toBeTruthy();
  const frame = await getFrame(page, id!);
  const after = await getDocumentJson(page);
  await page.keyboard.press('Meta+z');
  expect(await getDocumentJson(page)).toBe(before);
  await page.keyboard.press('Meta+Shift+z');
  expect(await getDocumentJson(page)).toBe(after);
  await setSelection(page, [id!]);
  return frame;
}

test.describe('shapes', () => {
  test.beforeEach(async ({ galley }) => {
    await loadDoc(galley.page);
    await galley.page.keyboard.press('Meta+1');
  });

  test('the rectangle tool draws a rectangle by dragging, with a 1 pt black stroke and no fill', async ({ galley }) => {
    const f = await draw(galley.page, 'rectangle', { x: 100, y: 100 }, { x: 250, y: 200 });
    expect(f).toMatchObject({ type: 'rect', x: 100, y: 100, w: 150, h: 100, rotation: 0, fill: null, stroke: { paint: { swatchId: 'black', tint: 100 }, weight: 1 } });
    // dragging up and to the left draws the same rectangle
    const g = await draw(galley.page, 'rectangle', { x: 400, y: 300 }, { x: 300, y: 250 });
    expect(g).toMatchObject({ x: 300, y: 250, w: 100, h: 50 });
  });

  test('shift draws a square, alt draws from the center', async ({ galley }) => {
    const { page } = galley;
    const sq = await draw(page, 'rectangle', { x: 100, y: 100 }, { x: 260, y: 150 }, ['Shift']);
    expect(sq).toMatchObject({ x: 100, y: 100, w: 160, h: 160 });
    const c = await draw(page, 'rectangle', { x: 300, y: 300 }, { x: 340, y: 330 }, ['Alt']);
    expect(c).toMatchObject({ x: 260, y: 270, w: 80, h: 60 });
  });

  test('the ellipse tool draws an ellipse; shift makes it a circle', async ({ galley }) => {
    const { page } = galley;
    const e = await draw(page, 'ellipse', { x: 100, y: 300 }, { x: 220, y: 380 });
    expect(e).toMatchObject({ type: 'ellipse', x: 100, y: 300, w: 120, h: 80, fill: null, stroke: { weight: 1 } });
    const circle = await draw(page, 'ellipse', { x: 300, y: 300 }, { x: 400, y: 340 }, ['Shift']);
    expect(circle).toMatchObject({ type: 'ellipse', w: 100, h: 100 });
  });

  test('the line tool draws a line (a horizontal box of zero height, turned about its center); shift snaps to 45 degrees', async ({ galley }) => {
    const { page } = galley;
    const h = await draw(page, 'line', { x: 100, y: 500 }, { x: 300, y: 500 });
    expect(h).toMatchObject({ type: 'line', x: 100, y: 500, w: 200, h: 0, rotation: 0, fill: null, stroke: { weight: 1 } });
    const d = await draw(page, 'line', { x: 100, y: 600 }, { x: 200, y: 700 });
    expect(d.type).toBe('line');
    expect(d.w).toBeCloseTo(Math.hypot(100, 100), 3);
    expect(d.rotation).toBeCloseTo(45, 3);
    expect(d.h).toBe(0);
    // the line's center is the middle of the two end points
    expect(d.x + d.w / 2).toBeCloseTo(150, 3);
    expect(d.y).toBeCloseTo(650, 3);
    const s = await draw(page, 'line', { x: 300, y: 600 }, { x: 400, y: 620 }, ['Shift']);
    expect(s.rotation).toBe(0);
    expect(s.y).toBeCloseTo(600, 3);
    expect(s.w).toBeCloseTo(Math.hypot(100, 20), 3);
  });

  test('a click or a tiny drag draws nothing', async ({ galley }) => {
    const { page } = galley;
    await setTool(page, 'rectangle');
    await clickPage(page, { x: 200, y: 200 });
    await dragPage(page, { x: 200, y: 200 }, { x: 200.5, y: 200.5 });
    expect(Object.keys((await getDoc(page)).frames)).toEqual([]);
    expect(await undoSteps(page)).toBe(0);
  });

  test('Escape cancels a drawing drag', async ({ galley }) => {
    const { page } = galley;
    await setTool(page, 'ellipse');
    const before = await getDocumentJson(page);
    await dragPage(page, { x: 100, y: 100 }, { x: 200, y: 200 }, { hold: true });
    expect(Object.keys((await getDoc(page)).frames)).toHaveLength(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await flushInput(page);
    expect(await getDocumentJson(page)).toBe(before);
    expect(await undoSteps(page)).toBe(0);
  });

  test('the rectangle frame tool draws an empty graphic frame (drawn with an X)', async ({ galley }, testInfo) => {
    const { page } = galley;
    const f = await draw(page, 'rectangle-frame', { x: 100, y: 100 }, { x: 300, y: 220 });
    expect(f).toMatchObject({ type: 'image', x: 100, y: 100, w: 200, h: 120, assetId: null, content: null, fill: null, stroke: null });
    await page.mouse.move(5, 5);
    await expect(page.locator('[data-empty-image]')).toHaveCount(1);
    await snap(page, 'frame-tool', { testInfo });
  });
});

test.describe('text frames', () => {
  test.beforeEach(async ({ galley }) => {
    await loadDoc(galley.page);
    await galley.page.keyboard.press('Meta+1');
  });

  const storyText = (page: Page, storyId: string) =>
    page.evaluate((id) => {
      const g = (window as any).__galley;
      return g.model.storyPlainText(g.store.getState().history.doc.stories[id].doc) as string;
    }, storyId);

  test('drag a text frame with the Type tool, then type: the story holds "Hello"', async ({ galley }, testInfo) => {
    const { page } = galley;
    await setTool(page, 'type');
    await dragPage(page, { x: 100, y: 150 }, { x: 400, y: 230 });
    const [id] = await selection(page);
    const frame = await getFrame(page, id!);
    expect(frame).toMatchObject({ type: 'text', x: 100, y: 150, w: 300, h: 80, fill: null, stroke: null, inset: 0 });
    await expect(page.getByTestId('text-editor')).toBeFocused();
    expect(await storyText(page, frame.storyId)).toBe('');
    expect(await undoSteps(page)).toBe(1);

    await page.keyboard.type('Hello');
    expect(await storyText(page, frame.storyId)).toBe('Hello');
    // the page renderer underneath shows the same text, in the story's style
    await expect(page.locator(`.galley-text[data-frame-id="${id}"]`)).toHaveText('Hello');
    // all the typing is one undo step
    expect(await undoSteps(page)).toBe(2);
    await page.keyboard.type(', world');
    expect(await storyText(page, frame.storyId)).toBe('Hello, world');
    expect(await undoSteps(page)).toBe(2);

    await snap(page, 'text-typing', { testInfo });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('text-editor')).toHaveCount(0);
    expect(await selection(page)).toEqual([id]);

    // ⌘Z takes the typing back in one step, ⇧⌘Z puts it back
    await page.keyboard.press('Meta+z');
    expect(await storyText(page, frame.storyId)).toBe('');
    await page.keyboard.press('Meta+Shift+z');
    expect(await storyText(page, frame.storyId)).toBe('Hello, world');
  });

  test('Enter makes a paragraph, Backspace deletes; ⌘Z while typing undoes in the model and the editor follows', async ({ galley }) => {
    const { page } = galley;
    await setTool(page, 'type');
    await dragPage(page, { x: 100, y: 150 }, { x: 400, y: 260 });
    const [id] = await selection(page);
    const { storyId } = await getFrame(page, id!);
    await page.keyboard.type('One');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Two!');
    await page.keyboard.press('Backspace');
    expect(await storyText(page, storyId)).toBe('One\nTwo');
    expect(await page.evaluate((i) => (window as any).__galley.store.getState().history.doc.stories[i].doc.content.length, storyId)).toBe(2);

    await page.keyboard.press('Meta+z'); // the whole typing session is one step
    expect(await storyText(page, storyId)).toBe('');
    await expect(page.getByTestId('text-editor')).toHaveText('');
    await page.keyboard.type('Again');
    expect(await storyText(page, storyId)).toBe('Again');
  });

  test('clicking in an existing text frame with the Type tool, or double-clicking it, edits it in place', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page, { frames: [{ id: 't', type: 'text', x: 100, y: 100, w: 300, h: 60, text: 'Hello' }] });
    await page.keyboard.press('Meta+1');
    await setTool(page, 'type');
    await clickPage(page, { x: 250, y: 140 }); // empty space inside the frame: the caret goes to the end
    await expect(page.getByTestId('text-editor')).toBeFocused();
    await page.keyboard.type('!');
    expect(await storyText(page, 'story_t')).toBe('Hello!');
    await page.keyboard.press('Escape');

    await setTool(page, 'select');
    await clickPage(page, { x: 250, y: 140 });
    expect(await selection(page)).toEqual(['t']);
    await expect(page.getByTestId('text-editor')).toHaveCount(0);
    await page.mouse.dblclick((await page.getByTestId('canvas-viewport').boundingBox())!.x + 233 + 250, (await page.getByTestId('canvas-viewport').boundingBox())!.y + -5 + 140);
    await expect(page.getByTestId('text-editor')).toBeFocused();
    expect((await getEditorState(page)).activeTool).toBe('type');
    await page.keyboard.type('?');
    expect(await storyText(page, 'story_t')).toBe('Hello!?');
  });

  test('editing keeps bold and italic runs of the story', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page, { frames: [{ id: 't', type: 'text', x: 100, y: 100, w: 300, h: 60, text: '' }] });
    await page.evaluate(() => {
      const g = (window as any).__galley;
      const m = g.model;
      g.store.getState().dispatch(m.setStoryDoc, { storyId: 'story_t', doc: { type: 'doc', content: [m.paragraphNode('Plain ', m.textNode('bold', ['strong']), ' ', m.textNode('italic', ['em']))] } });
    });
    await page.keyboard.press('Meta+1');
    await setTool(page, 'type');
    await clickPage(page, { x: 380, y: 140 });
    await page.keyboard.type('!');
    const doc = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__galley.store.getState().history.doc.stories.story_t.doc)));
    expect(doc.content[0].content.map((r: any) => [r.text, (r.marks ?? []).map((m: any) => m.type).join('+')])).toEqual([
      ['Plain ', ''],
      ['bold', 'strong'],
      [' ', ''],
      ['italic!', 'em'],
    ]);
  });
});

test.describe('place image', () => {
  let dir: string;
  let png: string;
  let pngHash: string;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-place-'));
    png = path.join(dir, 'place-me.png');
    // a generated image (never a third-party photo): 1600 x 1000 pixels at 200 ppi, 576 x 360 pt natural size
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 40, g: 110, b: 200 } } })
      .composite([{ input: await sharp({ create: { width: 800, height: 500, channels: 3, background: { r: 240, g: 120, b: 30 } } }).png().toBuffer(), left: 400, top: 250 }])
      .withMetadata({ density: 200 })
      .png()
      .toBuffer()
      .then((b) => fs.writeFileSync(png, b));
    pngHash = `sha256:${createHash('sha256').update(fs.readFileSync(png)).digest('hex')}`;
  });

  const stubDialog = (app: ElectronApplication, file: string | null) =>
    app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({ canceled: f === null, filePaths: f === null ? [] : [f] })) as typeof dialog.showOpenDialog;
    }, file);

  test('⌘D links the file with a relative path and places it at the margin corner at native size, scaled to fit the margins', async ({ galley }, testInfo) => {
    const { page, app } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+0');
    await stubDialog(app, png);
    const before = await getDocumentJson(page);

    await page.keyboard.press('Meta+d');
    await expect.poll(async () => (await selection(page)).length).toBe(1);
    await flushInput(page);
    const doc = await getDoc(page);
    const assets = Object.values<any>(doc.assets);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: 'image', path: 'assets/place-me.png', hash: pngHash, width: 1600, height: 1000, ppi: 200, colorSpace: 'rgb' });
    expect(path.isAbsolute(assets[0].path)).toBe(false);

    const [id] = await selection(page);
    const frame = doc.frames[id!];
    // natural size 576 x 360 pt; the margin box is 540 x 720, so it scales to 540 wide
    expect(frame).toMatchObject({ type: 'image', assetId: assets[0].id, x: 36, y: 36, w: 540, h: 337.5, name: 'place-me.png' });
    expect(frame.content).toEqual({ x: 0, y: 0, w: 540, h: 337.5 });
    expect(await undoSteps(page)).toBe(1);

    await expect(page.locator(`.galley-image[data-frame-id="${id}"] img`)).toHaveCount(1);
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
    await page.mouse.move(5, 5);
    await snap(page, 'placed', { testInfo });
    await expectBaseline(page, 'placed');

    await page.keyboard.press('Meta+z');
    expect(await getDocumentJson(page)).toBe(before);
  });

  test('the file is copied into the open package under assets/', async ({ galley }) => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-pkg-'));
    fs.cpSync(FIXTURES.posterBasic, copy, { recursive: true });
    // relaunch on the copy so the placed file lands in a folder the test can look at
    await galley.close();
    const { launchApp } = await import('../helpers/launch');
    const g = await launchApp({ open: copy });
    try {
      await stubDialog(g.app, png);
      await g.page.waitForSelector('.galley-page[data-ready="true"]');
      await g.page.keyboard.press('Meta+d');
      await expect.poll(async () => Object.keys((await getDoc(g.page)).assets).length).toBe(2);
      const placed = Object.values<any>((await getDoc(g.page)).assets).find((a) => a.path !== 'assets/photo.jpg');
      expect(placed.path).toBe('assets/place-me.png');
      expect(fs.readFileSync(path.join(copy, placed.path)).equals(fs.readFileSync(png))).toBe(true);
    } finally {
      await g.close();
    }
  });

  test('cancelling the dialog changes nothing', async ({ galley }) => {
    const { page, app } = galley;
    await loadDoc(page);
    await stubDialog(app, null);
    await page.keyboard.press('Meta+d');
    await flushInput(page);
    await new Promise((r) => setTimeout(r, 300));
    expect(await undoSteps(page)).toBe(0);
    expect(Object.keys((await getDoc(page)).assets)).toEqual([]);
  });

  test('placing into a selected frame fills it proportionally; each fitting option sets its content rectangle', async ({ galley }) => {
    const { page, app } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+1');
    await stubDialog(app, png);
    await setTool(page, 'rectangle-frame');
    await dragPage(page, { x: 100, y: 100 }, { x: 400, y: 200 }); // a 300 x 100 frame; the image is 1.6:1
    const [id] = await selection(page);
    await setTool(page, 'select');

    await page.keyboard.press('Meta+d');
    await expect.poll(async () => (await getFrame(page, id!)).assetId).not.toBeNull();
    await flushInput(page);
    expect((await getDoc(page)).pages.page_1.items).toEqual([id]); // no new frame
    // fill proportionally: 300 wide, 187.5 tall, centered vertically
    expect((await getFrame(page, id!)).content).toEqual({ x: 0, y: -43.75, w: 300, h: 187.5 });

    const content = async () => (await getFrame(page, id!)).content;
    const steps = await undoSteps(page);

    await runCommand(page, 'object.fit.fitProportionally');
    expect(await content()).toEqual({ x: 70, y: 0, w: 160, h: 100 });
    await runCommand(page, 'object.fit.contentToFrame');
    expect(await content()).toEqual({ x: 0, y: 0, w: 300, h: 100 });
    await runCommand(page, 'object.fit.fillProportionally');
    expect(await content()).toEqual({ x: 0, y: -43.75, w: 300, h: 187.5 });
    await runCommand(page, 'object.fit.fitProportionally');
    // center keeps the size and centers it: after fit proportionally it is already centered, so move it first
    await page.evaluate((fid) => {
      const g = (window as any).__galley;
      g.store.getState().dispatch(g.model.setFrameProps, { ids: [fid], props: { content: { x: 5, y: 7, w: 160, h: 100 } } });
    }, id!);
    await runCommand(page, 'object.fit.center');
    expect(await content()).toEqual({ x: 70, y: 0, w: 160, h: 100 });
    expect(await undoSteps(page)).toBe(steps + 6); // 4 fits + the manual edit + center

    // each fitting option is one undo step
    const before = await getDocumentJson(page);
    await runCommand(page, 'object.fit.contentToFrame');
    await page.keyboard.press('Meta+z');
    expect(await getDocumentJson(page)).toBe(before);
  });

  test('fitting commands are disabled with no image frame selected', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page, { frames: [{ id: 'a', type: 'rect', x: 100, y: 100, w: 100 }] });
    await setSelection(page, ['a']);
    expect(await runCommand(page, 'object.fit.fillProportionally')).toBe(false);
  });
});

test('a page with every drawing tool used (screenshot)', async ({ galley }, testInfo) => {
  const { page } = galley;
  await loadDoc(page);
  await page.keyboard.press('Meta+0');
  const draws: [string, { x: number; y: number }, { x: number; y: number }][] = [
    ['rectangle', { x: 72, y: 90 }, { x: 252, y: 190 }],
    ['ellipse', { x: 300, y: 90 }, { x: 460, y: 190 }],
    ['line', { x: 72, y: 230 }, { x: 460, y: 280 }],
    ['rectangle-frame', { x: 72, y: 320 }, { x: 252, y: 440 }],
  ];
  for (const [tool, a, b] of draws) {
    await setTool(page, tool);
    await dragPage(page, a, b);
  }
  await setTool(page, 'type');
  await dragPage(page, { x: 300, y: 320 }, { x: 540, y: 440 });
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await setTool(page, 'select');
  await setSelection(page, []);
  await page.mouse.move(5, 5);
  expect(Object.keys((await getDoc(page)).frames)).toHaveLength(5);
  await snap(page, 'drawn', { testInfo });
  await expectBaseline(page, 'drawn');
});
