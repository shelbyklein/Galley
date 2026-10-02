import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIXTURES, launchApp } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState, runCommand } from '../helpers/app-state';
import { expectBaseline, snap, waitForStable } from '../helpers/screenshot';
import { clickMenuItem, dialogCalls, diffPngs, dispatchModel, findItem, getModelDoc, getShellState, readGalleyMenus, stubDialogs } from './helpers';

// P1-13: documents and files. New Document with presets, Open / Save / Save As for `.galley` packages, recent files,
// the dirty indicator and close prompt, relative image links, and the missing-link placeholder and warning.
test.use({ open: null });

let tmp: string;
test.beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-files-e2e-'));
});
test.afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const mm = (n: number) => (n * 72) / 25.4;

/**
 * The page as pixels, once it has stopped changing: opening a package changes its image URLs, so the picture reloads
 * after the document is swapped. Take shots until two in a row are identical (and every image has loaded).
 */
async function settledPageShot(page: import('@playwright/test').Page): Promise<Buffer> {
  await waitForStable(page);
  await expect
    .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.galley-page img')).every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
  let previous = await page.locator('.galley-page').screenshot();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await page.locator('.galley-page').screenshot();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the page never stopped changing');
}
const firstPage = (doc: any) => doc.pages[doc.pageOrder[0]];

/** A copy of the poster fixture in the temp folder. */
function copyPoster(name = 'Poster.galley'): string {
  const dest = path.join(tmp, name);
  fs.cpSync(FIXTURES.posterBasic, dest, { recursive: true });
  return dest;
}

test.describe('New Document', () => {
  const PRESETS: { id: string; label: string; width: number; height: number; close?: boolean }[] = [
    { id: 'letter', label: 'Letter', width: 612, height: 792 },
    { id: 'tabloid', label: 'Tabloid', width: 792, height: 1224 },
    { id: 'a4', label: 'A4', width: mm(210), height: mm(297), close: true },
    { id: 'a3', label: 'A3', width: mm(297), height: mm(420), close: true },
    { id: '18x24', label: '18 × 24 in', width: 1296, height: 1728 },
    { id: '24x36', label: '24 × 36 in', width: 1728, height: 2592 },
  ];

  test('each preset creates a document of its exact size in points', async ({ galley }) => {
    const { page } = galley;
    for (const preset of PRESETS) {
      await page.keyboard.press('Meta+n');
      const dialog = page.getByTestId('new-document-dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-field="preset"]').selectOption(preset.id);
      await dialog.getByTestId('dialog-ok').click();
      await expect(dialog).toHaveCount(0);

      const p = firstPage(await getModelDoc(page));
      if (preset.close) {
        expect(p.width, preset.label).toBeCloseTo(preset.width, 6);
        expect(p.height, preset.label).toBeCloseTo(preset.height, 6);
      } else {
        expect([p.width, p.height], preset.label).toEqual([preset.width, preset.height]);
      }
      expect((await getModelDoc(page)).meta.title).toBe('Untitled');
      expect((await getEditorState(page)).dirty).toBe(false);
      // the page on screen is that size too (1 pt = 1 CSS pt)
      const sheet = await page.locator('.galley-page').evaluate((el) => (el as HTMLElement).style.width);
      expect(parseFloat(sheet)).toBeGreaterThanOrEqual(preset.width - 0.001);
    }
  });

  test('margins, columns, gutter, bleed and slug go into the page', async ({ galley }, testInfo) => {
    const { page } = galley;
    await page.keyboard.press('Meta+n');
    const dialog = page.getByTestId('new-document-dialog');
    await dialog.locator('[data-field="preset"]').selectOption('tabloid');
    const type = async (field: string, text: string) => {
      await dialog.locator(`[data-field="${field}"]`).fill(text);
      await page.keyboard.press('Tab');
    };
    await type('margins-top', '0.5'); // linked: all four sides
    await type('columns', '3');
    await type('gutter', '12 pt');
    await type('bleed-top', '0.125');
    await type('slug-top', '0.5');
    await snap(page, 'new-document-dialog', { testInfo });
    await expectBaseline(page, 'new-document-dialog');
    await dialog.getByTestId('dialog-ok').click();

    const p = firstPage(await getModelDoc(page));
    expect(p).toMatchObject({
      width: 792,
      height: 1224,
      margins: { top: 36, right: 36, bottom: 36, left: 36 },
      columns: { count: 3, gutter: 12 },
      bleed: { top: 9, right: 9, bottom: 9, left: 9 },
      slug: { top: 36, right: 36, bottom: 36, left: 36 },
    });
    await expect(page.getByTestId('page-summary')).toHaveText('Tabloid 11 × 17 in · bleed 0.125 in · 3 columns');
  });

  test('unlinking a group lets the four sides differ; a custom size and landscape work; units convert', async ({ galley }) => {
    const { page } = galley;
    await page.keyboard.press('Meta+n');
    const dialog = page.getByTestId('new-document-dialog');
    await dialog.getByTestId('margins-link').click();
    await dialog.locator('[data-field="margins-left"]').fill('1 in');
    await page.keyboard.press('Tab');
    await dialog.locator('[data-field="unit"]').selectOption('mm');
    await expect(dialog.locator('[data-field="width"]')).toHaveValue(/^215\.9/); // 8.5 in in millimeters
    await dialog.locator('[data-field="width"]').fill('100');
    await page.keyboard.press('Tab');
    await dialog.locator('[data-field="height"]').fill('200');
    await page.keyboard.press('Tab');
    await expect(dialog.locator('[data-field="preset"]')).toHaveValue('custom');
    await dialog.locator('[data-orientation="landscape"]').click();
    await dialog.getByTestId('dialog-ok').click();
    const p = firstPage(await getModelDoc(page));
    expect(p.width).toBeCloseTo(mm(200), 6);
    expect(p.height).toBeCloseTo(mm(100), 6);
    expect(p.margins).toEqual({ top: 36, right: 36, bottom: 36, left: 72 });
  });

  test('refuses margins that leave no room, and Cancel leaves the document alone', async ({ galley }) => {
    const { page } = galley;
    const before = await getDocumentJson(page);
    await page.keyboard.press('Meta+n');
    const dialog = page.getByTestId('new-document-dialog');
    await dialog.locator('[data-field="margins-top"]').fill('5 in');
    await page.keyboard.press('Tab');
    await expect(dialog.getByTestId('dialog-error')).toContainText('margins');
    await expect(dialog.getByTestId('dialog-ok')).toBeDisabled();
    await dialog.getByTestId('dialog-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(await getDocumentJson(page)).toBe(before);
    await page.keyboard.press('Meta+n');
    await expect(page.getByTestId('new-document-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-document-dialog')).toHaveCount(0);
  });
});

test.describe('Save, Save As and Open', () => {
  test('Save As writes document.json, links.json and the images; reopening gives the same model and the same picture', async ({ galley }, testInfo) => {
    const { page, app } = galley;
    // start from the poster: a real document with an image and its link
    await stubDialogs(app, { open: [FIXTURES.posterBasic] });
    await clickMenuItem(app, 'file.open');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(FIXTURES.posterBasic);
    await waitForStable(page);
    const original = await getModelDoc(page);
    const originalJson = await getDocumentJson(page);
    const picture = await settledPageShot(page);

    const target = path.join(tmp, 'Copy of Poster.galley');
    await stubDialogs(app, { save: [target], open: [target] });
    await runCommand(page, 'file.saveAs');

    // the package on disk
    expect(fs.existsSync(path.join(target, 'document.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'links.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'assets', 'photo.jpg'))).toBe(true); // the linked image came along
    expect(fs.readFileSync(path.join(target, 'document.json'), 'utf8')).toBe(originalJson); // canonical: the same bytes as the model serializes to
    const links = JSON.parse(fs.readFileSync(path.join(target, 'links.json'), 'utf8'));
    expect(links.links.photo.path).toBe('assets/photo.jpg'); // relative, never absolute
    expect(JSON.stringify(links)).not.toContain(tmp);
    expect(JSON.parse(fs.readFileSync(path.join(target, 'document.json'), 'utf8')).meta.engineVersion).toBe('44.5.1');

    // the app now works on the copy and is clean
    expect((await getShellState(page)).packagePath).toBe(target);
    expect((await getEditorState(page)).dirty).toBe(false);

    // reopen it (the Open panel is stubbed to return the copy): the same model, the same picture
    await runCommand(page, 'file.open');
    await expect.poll(async () => (await getDocumentJson(page)) === originalJson).toBe(true);
    expect(await getModelDoc(page)).toEqual(original);
    const again = await settledPageShot(page);
    const diff = await diffPngs(picture, again);
    expect(diff.significant, `the reopened document renders like the original (${JSON.stringify(diff)})`).toBe(0);
    expect(diff.differing).toBeLessThan(diff.width * diff.height * 0.5); // resampling noise stays within the photo
    await snap(page, 'reopened-copy', { testInfo });
    await expectBaseline(page, 'reopened-copy');
    expect((await dialogCalls(app)).map((c) => c.kind)).toEqual(['save', 'open']);
  });

  test('Save writes in place; the first save of an untitled document names it after the file and clears the dirty mark', async ({ galley }) => {
    const { page, app } = galley;
    const target = path.join(tmp, 'My First.galley');
    await stubDialogs(app, { save: [target] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'Test Profile' }); // any change
    expect((await getEditorState(page)).dirty).toBe(true);
    await runCommand(page, 'file.save'); // never saved: asks where
    expect((await dialogCalls(app)).map((c) => c.kind)).toEqual(['save']);
    expect(fs.existsSync(path.join(target, 'document.json'))).toBe(true);
    expect((await getModelDoc(page)).meta.title).toBe('My First');
    expect((await getEditorState(page)).dirty).toBe(false);
    await expect(page.getByTestId('doc-title')).toHaveText('My First');

    // a second Save goes to the same place without asking
    await dispatchModel(page, 'setMeta', { colorProfile: 'Another' });
    await runCommand(page, 'file.save');
    expect((await dialogCalls(app)).map((c) => c.kind)).toEqual(['save']);
    expect(JSON.parse(fs.readFileSync(path.join(target, 'document.json'), 'utf8')).meta.colorProfile).toBe('Another');
    expect((await getEditorState(page)).dirty).toBe(false);

    // Save As elsewhere keeps the first copy untouched
    const second = path.join(tmp, 'Second.galley');
    await stubDialogs(app, { save: [second] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'Third' });
    await runCommand(page, 'file.saveAs');
    expect(JSON.parse(fs.readFileSync(path.join(second, 'document.json'), 'utf8')).meta.colorProfile).toBe('Third');
    expect(JSON.parse(fs.readFileSync(path.join(target, 'document.json'), 'utf8')).meta.colorProfile).toBe('Another');
    expect((await getShellState(page)).packagePath).toBe(second);
  });

  test('cancelling the Save As panel saves nothing and keeps the document dirty', async ({ galley }) => {
    const { page, app } = galley;
    await stubDialogs(app, { save: [] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await runCommand(page, 'file.save');
    expect((await getEditorState(page)).dirty).toBe(true);
    expect((await getShellState(page)).packagePath).toBeNull();
  });

  test('a saved document survives the full round trip through disk with every kind of frame', async ({ galley }) => {
    const { page, app } = galley;
    const file = path.join(tmp, 'Everything.galley');
    await page.evaluate(() => {
      const g = (window as unknown as { __galley: { store: { getState(): any }; model: any } }).__galley;
      const s = g.store.getState();
      const doc = s.history.doc;
      const layerId = doc.layerOrder[0];
      const pageId = doc.pageOrder[0];
      const base = { name: '', layerId, rotation: 0, fill: g.model.paint('black'), stroke: null };
      s.dispatch(g.model.addFrame, { frame: { ...base, id: 'r', type: 'rect', x: 10, y: 10, w: 50, h: 40 }, pageId });
      s.dispatch(g.model.addFrame, { frame: { ...base, id: 'e', type: 'ellipse', x: 70.5, y: 10.25, w: 50, h: 40, rotation: 30 }, pageId });
      s.dispatch(g.model.addFrame, { frame: { ...base, id: 'l', type: 'line', x: 10, y: 80, w: 100, h: 0, fill: null, stroke: { paint: g.model.paint('black'), weight: 2 } }, pageId });
      s.dispatch(g.model.addFrame, {
        frame: { ...base, id: 't', type: 'text', x: 10, y: 100, w: 200, h: 60, fill: null, storyId: 's', inset: 0 },
        pageId,
        story: g.model.createStory('s', 'Hello, world'),
      });
      s.dispatch(g.model.addFrame, { frame: { ...base, id: 'i', type: 'image', x: 10, y: 170, w: 80, h: 80, fill: null, assetId: null, content: null }, pageId });
      s.dispatch(g.model.addLayer, { layer: g.model.makeLayer({ id: 'layer_2', name: 'Second', color: '#ff453a', locked: true }) });
    });
    await stubDialogs(app, { save: [file], open: [file] });
    const before = await getModelDoc(page);
    await runCommand(page, 'file.saveAs');
    await runCommand(page, 'file.open');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(file);
    const after = await getModelDoc(page);
    expect(after.meta.title).toBe('Everything'); // adopted the file name
    expect({ ...after, meta: { ...after.meta, title: 'Untitled' } }).toEqual(before);
    expect(Object.keys(after.frames).sort()).toEqual(['e', 'i', 'l', 'r', 't']);
  });
});

test.describe('dirty indicator and close prompt', () => {
  test('the title bar and the window show unsaved changes until they are saved', async ({ galley }) => {
    const { page, app } = galley;
    await expect(page.getByTestId('dirty-mark')).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(false);

    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await expect(page.getByTestId('dirty-mark')).toBeVisible();
    await expect(page.getByTestId('dirty-mark')).toContainText('Edited');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(true);

    // undoing back to the saved state is clean again
    await runCommand(page, 'edit.undo');
    await expect(page.getByTestId('dirty-mark')).toHaveCount(0);
    await runCommand(page, 'edit.redo');
    await expect(page.getByTestId('dirty-mark')).toBeVisible();

    await stubDialogs(app, { save: [path.join(tmp, 'Dirty.galley')] });
    await runCommand(page, 'file.save');
    await expect(page.getByTestId('dirty-mark')).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(false);
  });

  test('closing a dirty document prompts; Cancel keeps it open', async ({ galley }) => {
    const { page, app } = galley;
    await stubDialogs(app, { confirm: ['cancel'] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(true);
    await runCommand(page, 'file.close');
    const calls = await dialogCalls(app);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('confirm');
    expect(calls[0]!.message).toContain('Untitled');
    expect(calls[0]!.message).toContain('before closing');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect((await getEditorState(page)).dirty).toBe(true);
  });

  test("closing with Don't Save closes the window without writing anything", async ({ galley }) => {
    const { page, app } = galley;
    await stubDialogs(app, { confirm: ['discard'] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    const closed = app.waitForEvent('close');
    void runCommand(page, 'file.close').catch(() => {});
    await closed;
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  test('closing with Save saves first, then closes', async ({ galley }) => {
    const { page, app } = galley;
    const target = path.join(tmp, 'Saved On Close.galley');
    await stubDialogs(app, { confirm: ['save'], save: [target] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'kept' });
    const closed = app.waitForEvent('close');
    void runCommand(page, 'file.close').catch(() => {});
    await closed;
    expect(JSON.parse(fs.readFileSync(path.join(target, 'document.json'), 'utf8')).meta.colorProfile).toBe('kept');
  });

  test('closing the window with its own button prompts too, and a clean document closes without asking', async ({ galley }) => {
    const { page, app } = galley;
    await stubDialogs(app, { confirm: ['cancel'] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect.poll(async () => (await dialogCalls(app)).length).toBe(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    await runCommand(page, 'edit.undo'); // clean again
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(false);
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closed;
  });

  test('New and Open ask about unsaved changes first, and Cancel stops them', async ({ galley }) => {
    const { page, app } = galley;
    await stubDialogs(app, { confirm: ['cancel', 'cancel'], open: [FIXTURES.posterBasic] });
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await page.keyboard.press('Meta+n');
    await expect.poll(async () => (await dialogCalls(app)).length).toBe(1);
    await expect(page.getByTestId('new-document-dialog')).toHaveCount(0);
    await page.keyboard.press('Meta+o');
    await expect.poll(async () => (await dialogCalls(app)).length).toBe(2);
    const calls = await dialogCalls(app);
    expect(calls.map((c) => c.kind)).toEqual(['confirm', 'confirm']);
    expect(calls[0]!.message).toContain('creating a new document');
    expect(calls[1]!.message).toContain('opening another document');
    expect((await getShellState(page)).packagePath).toBeNull(); // nothing was opened
  });
});

test.describe('recent files', () => {
  test('lists opened and saved documents, newest first; clicking one opens it; Clear Menu empties it', async ({ galley }) => {
    const { page, app } = galley;
    const a = copyPoster('Alpha.galley');
    const b = copyPoster('Beta.galley');
    await stubDialogs(app, { open: [a, b] });
    const recentLabels = async () => {
      const menus = await readGalleyMenus(app);
      return findItem(menus, (n) => n.id === 'menu:file.openRecent')!.items!.filter((i) => i.id === 'file.openRecent').map((i) => i.label);
    };
    expect(await recentLabels()).toEqual([]);

    await clickMenuItem(app, 'file.open');
    await expect.poll(recentLabels).toEqual(['Alpha']);
    await clickMenuItem(app, 'file.open');
    await expect.poll(recentLabels).toEqual(['Beta', 'Alpha']);

    // open Alpha from the menu
    await clickMenuItem(app, 'file.openRecent', 'Alpha');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(a);
    await expect.poll(recentLabels).toEqual(['Alpha', 'Beta']);

    await clickMenuItem(app, 'file.clearRecent');
    await expect.poll(recentLabels).toEqual([]);
    expect((await getShellState(page)).recents).toEqual([]);
  });

  test('are remembered between runs', async () => {
    const profile = path.join(tmp, 'profile');
    const doc = copyPoster('Remembered.galley');
    const first = await launchApp({ open: null, env: { GALLEY_USER_DATA: profile } });
    try {
      await stubDialogs(first.app, { open: [doc] });
      await clickMenuItem(first.app, 'file.open');
      await expect.poll(async () => (await getShellState(first.page)).recents.map((r) => r.name)).toEqual(['Remembered']);
    } finally {
      await first.close();
    }
    const second = await launchApp({ open: null, env: { GALLEY_USER_DATA: profile } });
    try {
      await expect.poll(async () => (await getShellState(second.page)).recents.map((r) => r.name)).toEqual(['Remembered']);
      await expect.poll(async () => findItem(await readGalleyMenus(second.app), (n) => n.id === 'file.openRecent')?.label).toBe('Remembered');
    } finally {
      await second.close();
    }
  });
});

test.describe('opening problems', () => {
  test('a folder that is not a package shows an error and keeps the current document', async ({ galley }) => {
    const { page, app } = galley;
    const empty = path.join(tmp, 'Empty.galley');
    fs.mkdirSync(empty);
    await stubDialogs(app, { open: [empty] });
    const before = await getDocumentJson(page);
    await runCommand(page, 'file.open');
    const notice = page.getByTestId('notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-level', 'error');
    await expect(notice).toContainText('no document.json');
    expect(await getDocumentJson(page)).toBe(before);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('a document the model cannot parse names the problem', async ({ galley }) => {
    const { page, app } = galley;
    const bad = copyPoster('Bad.galley');
    const doc = JSON.parse(fs.readFileSync(path.join(bad, 'document.json'), 'utf8'));
    doc.frames.spring.x = '36pt'; // a unit string, which the schema rejects
    fs.writeFileSync(path.join(bad, 'document.json'), JSON.stringify(doc));
    await stubDialogs(app, { open: [bad] });
    await runCommand(page, 'file.open');
    await expect(page.getByTestId('notice')).toContainText('Could not open');
    await expect(page.getByTestId('notice')).toContainText('points');
    expect((await getShellState(page)).packagePath).toBeNull();
  });

  test('a document saved by another Electron version warns that text can reflow', async ({ galley }) => {
    const { page, app } = galley;
    const old = copyPoster('Old.galley');
    const doc = JSON.parse(fs.readFileSync(path.join(old, 'document.json'), 'utf8'));
    doc.meta.engineVersion = '41.0.0';
    fs.writeFileSync(path.join(old, 'document.json'), JSON.stringify(doc));
    await stubDialogs(app, { open: [old] });
    await runCommand(page, 'file.open');
    await expect(page.getByTestId('notice')).toContainText('41.0.0');
    await expect(page.getByTestId('notice')).toHaveAttribute('data-level', 'warning');
    expect((await getShellState(page)).packagePath).toBe(old);
  });
});

test.describe('image links', () => {
  test('a renamed image shows the missing-link placeholder and a warning; putting it back and reopening clears them', async ({ galley }, testInfo) => {
    const { page, app } = galley;
    const pkg = copyPoster('Links.galley');
    const photo = path.join(pkg, 'assets', 'photo.jpg');
    fs.renameSync(photo, path.join(pkg, 'assets', 'photo-renamed.jpg'));

    await stubDialogs(app, { open: [pkg, pkg] });
    await runCommand(page, 'file.open');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(pkg);

    // the warning, over the canvas and in the status bar
    const warning = page.getByTestId('link-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('1 linked image is missing');
    await expect(warning).toContainText('assets/photo.jpg');
    await expect(page.getByTestId('status-missing-links')).toHaveText(/1 missing link/);
    expect((await getShellState(page)).missingLinks).toEqual([{ assetId: 'photo', path: 'assets/photo.jpg' }]);

    // the placeholder fills the image frame; the model still has the link
    await waitForStable(page);
    const src = await page.locator('.galley-image img').getAttribute('src');
    expect(src).toContain('assets/photo.jpg');
    // the image that loaded is the 200 x 120 placeholder, not the 2400 x 1280 photo
    const loaded = await page.locator('.galley-image img').evaluate((img: HTMLImageElement) => ({ ok: img.complete, w: img.naturalWidth, h: img.naturalHeight }));
    expect(loaded).toEqual({ ok: true, w: 200, h: 120 });
    expect((await getModelDoc(page)).assets.photo.path).toBe('assets/photo.jpg');
    expect((await getEditorState(page)).dirty).toBe(false);
    await snap(page, 'missing-link', { testInfo });
    await expectBaseline(page, 'missing-link');

    // dismissing hides the banner but not the status bar warning
    await warning.getByRole('button', { name: 'Dismiss' }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.getByTestId('status-missing-links')).toBeVisible();

    // put the file back and reopen: no warning, the real picture
    fs.renameSync(path.join(pkg, 'assets', 'photo-renamed.jpg'), photo);
    await runCommand(page, 'file.open');
    await expect.poll(async () => (await getShellState(page)).missingLinks).toEqual([]);
    await expect(page.getByTestId('link-warning')).toHaveCount(0);
    await expect(page.getByTestId('status-missing-links')).toHaveCount(0);
    await waitForStable(page);
    const natural = await page.locator('.galley-image img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(natural).toEqual([2400, 1280]);
  });

  test('saving a document with a missing link keeps the link and keeps warning', async ({ galley }) => {
    const { page, app } = galley;
    const pkg = copyPoster('Keep.galley');
    fs.rmSync(path.join(pkg, 'assets', 'photo.jpg'));
    await stubDialogs(app, { open: [pkg] });
    await runCommand(page, 'file.open');
    await expect(page.getByTestId('link-warning')).toBeVisible();
    await dispatchModel(page, 'setMeta', { colorProfile: 'x' });
    await runCommand(page, 'file.save');
    const links = JSON.parse(fs.readFileSync(path.join(pkg, 'links.json'), 'utf8'));
    expect(links.links.photo.path).toBe('assets/photo.jpg');
    expect((await getShellState(page)).missingLinks).toHaveLength(1);
  });
});
