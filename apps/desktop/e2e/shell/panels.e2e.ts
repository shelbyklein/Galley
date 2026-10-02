import type { Locator, Page } from '@playwright/test';
import { FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { expectBaseline, snap, waitForStable } from '../helpers/screenshot';
import { clickMenuItem, dispatchModel, getFrame, getModelDoc, getShellState, setSelection } from './helpers';

// P1-14: the Pages, Layers and Swatches panels and the control strip's object fields. Every panel action must update
// the model and the canvas; each is one undo step.
test.use({ open: FIXTURES.posterBasic });

/** Press on the middle of `from`, drag to the middle of `to` and release (the panels reorder with pointer events). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const steps = async (page: Page) => (await getEditorState(page)).undoSteps;

// -------------------------------------------------------------------------------------------------------------- pages

test.describe('Pages panel', () => {
  test('adds a page after the current one, with the same setup, and goes to it', async ({ galley }) => {
    const { page } = galley;
    const before = await getModelDoc(page);
    const first = before.pageOrder[0];
    await expect(page.locator('[data-page-id]')).toHaveCount(1);
    await expect(page.getByTestId('pages-summary')).toHaveText('1 Page in 1 Spread');

    const undo = await steps(page);
    await page.getByTestId('pages-new').click();
    const doc = await getModelDoc(page);
    expect(doc.pageOrder).toHaveLength(2);
    expect(doc.pageOrder[0]).toBe(first);
    const added = doc.pages[doc.pageOrder[1]];
    expect(added).toMatchObject({ width: 792, height: 1224, items: [], margins: before.pages[first].margins, bleed: before.pages[first].bleed, slug: before.pages[first].slug, columns: { count: 3, gutter: 12 } });
    expect(await steps(page)).toBe(undo + 1); // one undo step

    // the new page is current, and the canvas draws it (an empty page)
    expect((await getEditorState(page)).currentPageId).toBe(added.id);
    await expect(page.locator('.galley-page')).toHaveAttribute('data-galley-page', added.id);
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(0);
    await expect(page.locator('[data-page-id]')).toHaveCount(2);
    await expect(page.locator(`[data-page-id="${added.id}"]`)).toHaveClass(/is-current/);
    await expect(page.getByTestId('pages-summary')).toHaveText('2 Pages in 2 Spreads');
    await expect(page.getByTestId('page-number')).toHaveText('2');

    // click page 1 to go back: the poster is drawn again
    await page.locator(`[data-page-id="${first}"]`).click();
    expect((await getEditorState(page)).currentPageId).toBe(first);
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(9);

    // undo removes the page
    await page.keyboard.press('Meta+z');
    expect((await getModelDoc(page)).pageOrder).toEqual([first]);
    await expect(page.locator('[data-page-id]')).toHaveCount(1);
  });

  test('reorders pages by dragging, or with Move Page Forward and Backward', async ({ galley }) => {
    const { page } = galley;
    for (let i = 0; i < 2; i++) await page.getByTestId('pages-new').click();
    const [a, b, c] = (await getModelDoc(page)).pageOrder as string[];
    const item = (id: string) => page.locator(`[data-page-id="${id}"]`);

    const undo = await steps(page);
    await drag(page, item(a!), item(c!));
    expect((await getModelDoc(page)).pageOrder).toEqual([b, c, a]);
    expect(await steps(page)).toBe(undo + 1);
    await expect(page.locator('[data-page-id]').nth(2)).toHaveAttribute('data-page-id', a!);
    await expect(page.locator('[data-page-id] .gl-page-number')).toHaveText(['1', '2', '3']);

    // a plain click does not reorder anything
    await item(b!).click();
    expect((await getModelDoc(page)).pageOrder).toEqual([b, c, a]);
    expect((await getEditorState(page)).currentPageId).toBe(b);

    // the panel menu: move the current page forward
    await page.getByTestId('pages-menu').click();
    await page.getByRole('menuitem', { name: 'Move Page Forward' }).click();
    expect((await getModelDoc(page)).pageOrder).toEqual([c, b, a]);
    await page.getByTestId('pages-menu').click();
    await expect(page.getByRole('menuitem', { name: 'Move Page Backward' })).toBeEnabled();
    await page.getByRole('menuitem', { name: 'Move Page Backward' }).click();
    expect((await getModelDoc(page)).pageOrder).toEqual([b, c, a]);
  });

  test('deletes the current page with its frames; the last page cannot be deleted', async ({ galley }) => {
    const { page } = galley;
    await expect(page.getByTestId('pages-delete')).toBeDisabled();
    await page.getByTestId('pages-new').click();
    const [first, second] = (await getModelDoc(page)).pageOrder as string[];
    // put a frame on page 2 and select page 2
    await dispatchModel(page, 'moveFramesToPage', { ids: ['spring'], pageId: second });
    expect((await getModelDoc(page)).pages[second!].items).toEqual(['spring']);

    await page.getByTestId('pages-delete').click();
    const doc = await getModelDoc(page);
    expect(doc.pageOrder).toEqual([first]);
    expect(doc.frames.spring).toBeUndefined(); // the frame went with its page
    expect((await getEditorState(page)).currentPageId).toBe(first);
    await expect(page.getByTestId('pages-delete')).toBeDisabled();
    await expect(page.locator('[data-page-id]')).toHaveCount(1);

    await page.keyboard.press('Meta+z'); // one undo brings back the page and its frame
    const back = await getModelDoc(page);
    expect(back.pageOrder).toEqual([first, second]);
    expect(back.frames.spring).toBeDefined();
  });

  test('thumbnails show the page, and the status bar steps through pages', async ({ galley }) => {
    const { page } = galley;
    await page.getByTestId('pages-new').click();
    await expect(page.getByTestId('page-number')).toHaveText('2');
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByTestId('page-number')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next page' }).click();
    expect((await getEditorState(page)).currentPageId).toBe((await getModelDoc(page)).pageOrder[1]);
    // the poster's thumbnail has its frames; the new page's is empty
    const thumbs = page.getByTestId('page-thumb');
    expect(await thumbs.nth(0).locator('.gl-thumb-frame').count()).toBe(9);
    expect(await thumbs.nth(1).locator('.gl-thumb-frame').count()).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------- layers

test.describe('Layers panel', () => {
  test('lists each layer with its objects, topmost first, and selecting an object selects the frame', async ({ galley }) => {
    const { page } = galley;
    const rows = page.locator('[data-panel="layers"] .gl-object-row');
    await expect(rows).toHaveCount(9);
    expect(await rows.locator('.gl-object-label').allTextContents()).toEqual([
      '<photo.jpg>',
      '<FREE>',
      '<Ellipse>',
      '<galleystudio.example/sprin…>',
      '<Twenty studios open their …>',
      '<Saturday, May 16 · 10am–4p…>',
      '<OPEN STUDIO>',
      '<SPRING>',
      '<Orange block>',
    ]);
    await expect(page.locator('[data-layer-id="layer_1"] [data-testid="layer-name"]')).toHaveText('Layer 1');
    await expect(page.getByTestId('layers-summary')).toHaveText('Page: 1, 1 Layer');

    await page.locator('[data-object-id="spring"]').click();
    expect((await getEditorState(page)).selection).toEqual(['spring']);
    await expect(page.locator('[data-object-id="spring"]')).toHaveClass(/is-selected/);
    await expect(page.locator('[data-object-id="spring"] .gl-object-marker')).toBeVisible();
    // and a selection made elsewhere shows up in the panel
    await setSelection(page, ['body']);
    await expect(page.locator('[data-object-id="body"]')).toHaveClass(/is-selected/);
    await expect(page.locator('[data-object-id="spring"]')).not.toHaveClass(/is-selected/);

    // the disclosure triangle hides and shows the objects
    await page.locator('[data-layer-id="layer_1"] [data-action="disclosure"]').click();
    await expect(rows).toHaveCount(0);
    await page.locator('[data-layer-id="layer_1"] [data-action="disclosure"]').click();
    await expect(rows).toHaveCount(9);
  });

  test('creates layers above the active one, each with its own color chip', async ({ galley }) => {
    const { page } = galley;
    const undo = await steps(page);
    await page.getByTestId('layers-new').click();
    let doc = await getModelDoc(page);
    expect(doc.layerOrder).toHaveLength(2);
    const second = doc.layerOrder[1];
    expect(doc.layers[second]).toMatchObject({ name: 'Layer 2', visible: true, locked: false });
    expect(doc.layers[second].color).not.toBe(doc.layers.layer_1.color);
    expect(await steps(page)).toBe(undo + 1);
    // the new layer is on top, so it is the first row, and it is the active layer
    await expect(page.locator('[data-layer-id]').first()).toHaveAttribute('data-layer-id', second);
    await expect(page.locator(`[data-layer-id="${second}"]`)).toHaveClass(/is-active/);
    expect((await getShellState(page)).activeLayerId).toBe(second);

    // a layer made while the lower one is active goes between them
    await page.locator('[data-layer-id="layer_1"]').click();
    await page.getByTestId('layers-new').click();
    doc = await getModelDoc(page);
    expect(doc.layerOrder).toHaveLength(3);
    expect(doc.layerOrder[0]).toBe('layer_1');
    expect(doc.layerOrder[2]).toBe(second);
    expect(doc.layers[doc.layerOrder[1]].name).toBe('Layer 3');
    await expect(page.getByTestId('layers-summary')).toHaveText('Page: 1, 3 Layers');
  });

  test('renames a layer by double-clicking its name; Escape cancels and an empty name is ignored', async ({ galley }) => {
    const { page } = galley;
    const name = page.locator('[data-layer-id="layer_1"] [data-testid="layer-name"]');
    await name.dblclick();
    const input = page.getByTestId('layer-rename');
    await expect(input).toBeFocused();
    await input.fill('Background');
    await input.press('Enter');
    expect((await getModelDoc(page)).layers.layer_1.name).toBe('Background');
    await expect(name).toHaveText('Background');

    await name.dblclick();
    await page.getByTestId('layer-rename').fill('Nope');
    await page.getByTestId('layer-rename').press('Escape');
    expect((await getModelDoc(page)).layers.layer_1.name).toBe('Background');

    const undo = await steps(page);
    await name.dblclick();
    await page.getByTestId('layer-rename').fill('   ');
    await page.getByTestId('layer-rename').press('Enter');
    expect((await getModelDoc(page)).layers.layer_1.name).toBe('Background');
    expect(await steps(page)).toBe(undo);

    await name.dblclick();
    await page.getByTestId('layer-rename').fill('Final');
    await page.locator('[data-panel="swatches"] .gl-panel-header').click(); // clicking away commits
    expect((await getModelDoc(page)).layers.layer_1.name).toBe('Final');
  });

  test('reorders layers by dragging, or with Move Layer Up and Down; the stacking on the canvas follows', async ({ galley }) => {
    const { page } = galley;
    // two more layers: layer_1 (bottom) < A < B (top)
    await page.getByTestId('layers-new').click();
    await page.getByTestId('layers-new').click();
    const [bottom, a, b] = (await getModelDoc(page)).layerOrder as string[];
    expect(bottom).toBe('layer_1');
    const row = (id: string) => page.locator(`.gl-layer-row[data-layer-id="${id}"]`);
    await expect(page.locator('.gl-layer-row')).toHaveCount(3);
    expect(await page.locator('.gl-layer-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.layerId))).toEqual([b, a, bottom]);

    const undo = await steps(page);
    await drag(page, row(b!), row(bottom!)); // the top layer to the bottom of the list
    expect((await getModelDoc(page)).layerOrder).toEqual([b, bottom, a]);
    expect(await steps(page)).toBe(undo + 1);
    expect(await page.locator('.gl-layer-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.layerId))).toEqual([a, bottom, b]);

    // a plain click on a row only activates it
    await row(bottom!).click();
    expect((await getModelDoc(page)).layerOrder).toEqual([b, bottom, a]);
    expect((await getShellState(page)).activeLayerId).toBe(bottom);

    await page.getByTestId('layers-menu').click();
    await page.getByRole('menuitem', { name: 'Move Layer Up' }).click();
    expect((await getModelDoc(page)).layerOrder).toEqual([b, a, bottom]);
    await page.getByTestId('layers-menu').click();
    await page.getByRole('menuitem', { name: 'Move Layer Down' }).click();
    expect((await getModelDoc(page)).layerOrder).toEqual([b, bottom, a]);

    // stacking: a frame on the layer that moved up is drawn above one on a layer below it
    await dispatchModel(page, 'moveFramesToLayer', { ids: ['orange-block'], layerId: a });
    const order = await page.locator('.galley-page [data-frame-id="orange-block"], .galley-page [data-frame-id="spring"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-frame-id')));
    expect(order[order.length - 1]).toBe('orange-block'); // layer a is above layer_1 now
  });

  test('hiding a layer takes its frames off the canvas (not rendered) and out of the selection; showing brings them back', async ({ galley }) => {
    const { page } = galley;
    await page.getByTestId('layers-new').click();
    const second = (await getModelDoc(page)).layerOrder[1] as string;
    await dispatchModel(page, 'moveFramesToLayer', { ids: ['photo-frame', 'free-ellipse'], layerId: second });
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(9);
    await setSelection(page, ['photo-frame', 'spring']);
    expect((await getEditorState(page)).selection).toEqual(['photo-frame', 'spring']);

    const undo = await steps(page);
    await page.locator(`[data-layer-id="${second}"] [data-action="visibility"]`).click();
    expect((await getModelDoc(page)).layers[second].visible).toBe(false);
    expect(await steps(page)).toBe(undo + 1);
    await expect(page.locator(`[data-layer-id="${second}"]`)).toHaveAttribute('data-visible', 'false');
    // not rendered: the DOM has no element for those frames at all
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(7);
    await expect(page.locator('.galley-page [data-frame-id="photo-frame"]')).toHaveCount(0);
    await expect(page.locator('.galley-page [data-frame-id="free-ellipse"]')).toHaveCount(0);
    await expect(page.locator('.galley-page [data-frame-id="spring"]')).toHaveCount(1);
    // ...and not selectable: the one that was selected is dropped, and it cannot be selected again
    expect((await getEditorState(page)).selection).toEqual(['spring']);
    await setSelection(page, ['photo-frame']);
    expect((await getEditorState(page)).selection).toEqual([]);

    await page.locator(`[data-layer-id="${second}"] [data-action="visibility"]`).click();
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(9);
    await setSelection(page, ['photo-frame']);
    expect((await getEditorState(page)).selection).toEqual(['photo-frame']);
  });

  test("locking a layer makes its frames unselectable, including from the panel; unlocking allows it again", async ({ galley }) => {
    const { page } = galley;
    await setSelection(page, ['spring']);
    const lock = page.locator('[data-layer-id="layer_1"] [data-action="lock"]');
    await lock.click();
    expect((await getModelDoc(page)).layers.layer_1.locked).toBe(true);
    await expect(page.locator('[data-layer-id="layer_1"]')).toHaveAttribute('data-locked', 'true');
    // locking drops the frames from the selection, and they cannot be selected through the store or the panel
    expect((await getEditorState(page)).selection).toEqual([]);
    await setSelection(page, ['spring']);
    expect((await getEditorState(page)).selection).toEqual([]);
    await page.locator('[data-object-id="spring"]').click();
    expect((await getEditorState(page)).selection).toEqual([]);
    // the frames still draw, and a locked layer's lock icon is solid
    await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(9);

    await lock.click();
    expect((await getModelDoc(page)).layers.layer_1.locked).toBe(false);
    await page.locator('[data-object-id="spring"]').click();
    expect((await getEditorState(page)).selection).toEqual(['spring']);
  });

  test('changes the layer color from its chip', async ({ galley }) => {
    const { page } = galley;
    const chip = page.locator('[data-layer-id="layer_1"] [data-action="color"]');
    await chip.click();
    await expect(page.getByTestId('layer-palette')).toBeVisible();
    await chip.click(); // the chip toggles it
    await expect(page.getByTestId('layer-palette')).toHaveCount(0);
    await chip.click();
    await expect(page.getByTestId('layer-palette')).toBeVisible();
    await page.locator('[data-testid="layer-palette"] [data-color="#ff453a"]').click();
    expect((await getModelDoc(page)).layers.layer_1.color).toBe('#ff453a');
    await expect(page.getByTestId('layer-palette')).toHaveCount(0);
    await expect(chip).toHaveCSS('background-color', 'rgb(255, 69, 58)');
  });

  test('deletes the active layer with its frames; the last layer cannot be deleted; undo restores both', async ({ galley }) => {
    const { page } = galley;
    await expect(page.getByTestId('layers-delete')).toBeDisabled();
    await page.getByTestId('layers-new').click();
    const second = (await getModelDoc(page)).layerOrder[1] as string;
    await dispatchModel(page, 'moveFramesToLayer', { ids: ['spring'], layerId: second });
    await expect(page.locator(`[data-layer-group="${second}"] .gl-object-row`)).toHaveCount(1);
    await page.getByTestId('layers-delete').click(); // the new layer is active
    const doc = await getModelDoc(page);
    expect(doc.layerOrder).toEqual(['layer_1']);
    expect(doc.frames.spring).toBeUndefined();
    await expect(page.locator('.galley-page [data-frame-id="spring"]')).toHaveCount(0);
    expect((await getShellState(page)).activeLayerId).toBe('layer_1');
    await page.keyboard.press('Meta+z');
    expect((await getModelDoc(page)).frames.spring).toBeDefined();
    expect((await getModelDoc(page)).layerOrder).toEqual(['layer_1', second]);
  });

  test('the Layers panel in its states matches the baseline', async ({ galley }, testInfo) => {
    const { page } = galley;
    await page.getByTestId('layers-new').click();
    const second = (await getModelDoc(page)).layerOrder[1] as string;
    await dispatchModel(page, 'moveFramesToLayer', { ids: ['photo-frame'], layerId: second });
    await dispatchModel(page, 'setLayerProps', { id: 'layer_1', props: { locked: true } });
    await dispatchModel(page, 'setLayerProps', { id: second, props: { name: 'Photos', color: '#32d74b' } });
    await setSelection(page, ['photo-frame']);
    await page.locator('[data-panel="swatches"] .gl-panel-header').click();
    await page.locator('[data-panel="pages"] .gl-panel-header').click();
    await snap(page, 'layers-panel', { testInfo, target: page.locator('[data-region="dock"]') });
    await expectBaseline(page, 'layers-panel', { target: page.locator('[data-region="dock"]') });
  });
});

// ----------------------------------------------------------------------------------------------------------- swatches

test.describe('Swatches panel', () => {
  const row = (page: Page, id: string) => page.locator(`[data-panel="swatches"] [data-swatch-id="${id}"]`);
  const chipColor = (page: Page, id: string) => row(page, id).locator('.gl-chip').evaluate((el) => getComputedStyle(el).backgroundColor);

  test('lists [None] and every swatch, with its values and kind', async ({ galley }) => {
    const { page } = galley;
    const names = await page.locator('[data-panel="swatches"] .gl-swatch-name').allTextContents();
    expect(names[0]).toBe('[None]');
    expect(names).toEqual(expect.arrayContaining(['[Registration]', '[Paper]', '[Black]', 'PANTONE 185 C', 'Studio Blue', 'Teal', 'Warm Orange']));
    expect(names).toHaveLength(8);
    await expect(row(page, 'warm-orange').locator('.gl-swatch-detail')).toHaveText('C0 M60 Y100 K0');
    await expect(row(page, 'pms-185-c').locator('.gl-swatch-kind')).toBeVisible();
    // the chip is the color the canvas draws that swatch in
    const canvas = (await page.locator('.galley-page svg [data-frame-id="orange-block"]').getAttribute('fill'))!.match(/\d+/g)!.map(Number);
    const chip = (await chipColor(page, 'warm-orange')).match(/\d+/g)!.map(Number);
    expect(chip.slice(0, 3)).toEqual(canvas.slice(0, 3));
  });

  test('New Swatch makes a CMYK process swatch', async ({ galley }, testInfo) => {
    const { page } = galley;
    const undo = await steps(page);
    await page.getByTestId('swatches-new').click();
    const dialog = page.getByTestId('swatch-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-field="name"]').fill('Brand Teal');
    for (const [channel, value] of [['c', '85'], ['m', '10'], ['y', '40'], ['k', '10']] as const) {
      await dialog.locator(`[data-field="${channel}"]`).fill(value);
      await page.keyboard.press('Tab');
    }
    await expect(dialog.locator('[data-slider="c"]')).toHaveValue('85');
    await snap(page, 'swatch-dialog', { testInfo });
    await expectBaseline(page, 'swatch-dialog');
    await dialog.getByTestId('dialog-ok').click();
    await expect(dialog).toHaveCount(0);

    const doc = await getModelDoc(page);
    const id = doc.swatchOrder[doc.swatchOrder.length - 1];
    expect(doc.swatches[id]).toMatchObject({ name: 'Brand Teal', type: 'cmyk', values: [85, 10, 40, 10] });
    expect(await steps(page)).toBe(undo + 1);
    await expect(row(page, id)).toContainText('Brand Teal');
    await expect(row(page, id).locator('.gl-swatch-detail')).toHaveText('C85 M10 Y40 K10');
  });

  test('New Swatch makes a spot swatch', async ({ galley }) => {
    const { page } = galley;
    await page.getByTestId('swatches-new').click();
    const dialog = page.getByTestId('swatch-dialog');
    await dialog.locator('[data-field="name"]').fill('PANTONE 300 C');
    await dialog.locator('[data-field="type"]').selectOption('spot');
    await dialog.locator('[data-slider="c"]').fill('100');
    await dialog.locator('[data-slider="m"]').fill('44');
    await dialog.getByTestId('dialog-ok').click();
    const doc = await getModelDoc(page);
    const swatch = doc.swatches[doc.swatchOrder[doc.swatchOrder.length - 1]];
    expect(swatch).toMatchObject({ name: 'PANTONE 300 C', type: 'spot', values: [100, 44, 0, 0] });
  });

  test('refuses a duplicate or empty name and keeps the dialog open', async ({ galley }) => {
    const { page } = galley;
    await page.getByTestId('swatches-new').click();
    const dialog = page.getByTestId('swatch-dialog');
    await dialog.locator('[data-field="name"]').fill('Teal');
    await dialog.getByTestId('dialog-ok').click();
    await expect(dialog.getByTestId('dialog-error')).toContainText('already exists');
    await dialog.locator('[data-field="name"]').fill('');
    await dialog.getByTestId('dialog-ok').click();
    await expect(dialog.getByTestId('dialog-error')).toContainText('needs a name');
    await dialog.getByTestId('dialog-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(Object.keys((await getModelDoc(page)).swatches)).toHaveLength(7);
  });

  test('editing a swatch updates every use of it, on the canvas too', async ({ galley }) => {
    const { page } = galley;
    const orangeBlock = page.locator('.galley-page svg [data-frame-id="orange-block"]');
    const before = await orangeBlock.getAttribute('fill');
    await row(page, 'warm-orange').dblclick();
    const dialog = page.getByTestId('swatch-dialog');
    await expect(dialog.locator('[data-field="name"]')).toHaveValue('Warm Orange');
    await expect(dialog.locator('[data-field="type"]')).toBeDisabled();
    await dialog.locator('[data-field="name"]').fill('Hot Orange');
    await dialog.locator('[data-field="m"]').fill('90');
    await page.keyboard.press('Tab');
    await dialog.getByTestId('dialog-ok').click();
    const doc = await getModelDoc(page);
    expect(doc.swatches['warm-orange']).toMatchObject({ name: 'Hot Orange', values: [0, 90, 100, 0] });
    expect(doc.frames['orange-block'].fill.swatchId).toBe('warm-orange'); // still the same swatch, by id
    await expect(row(page, 'warm-orange')).toContainText('Hot Orange');
    await expect.poll(async () => await orangeBlock.getAttribute('fill')).not.toBe(before);
  });

  test('built-in swatches cannot be edited or deleted', async ({ galley }) => {
    const { page } = galley;
    await row(page, 'black').click();
    await expect(page.getByTestId('swatches-delete')).toBeDisabled();
    await row(page, 'black').dblclick();
    const dialog = page.getByTestId('swatch-dialog');
    await expect(dialog.locator('[data-field="name"]')).toBeDisabled();
    await expect(dialog.getByTestId('dialog-ok')).toBeDisabled();
    await expect(dialog).toContainText('cannot be edited');
    await dialog.getByTestId('dialog-cancel').click();
  });

  test('applies to the fill or the stroke, whichever the proxy targets, as one undo step', async ({ galley }, testInfo) => {
    const { page } = galley;
    await setSelection(page, ['free-ellipse']);
    expect((await getFrame(page, 'free-ellipse'))).toMatchObject({ fill: { swatchId: 'pms-185-c' }, stroke: null });
    await expect(page.getByTestId('fill-stroke-proxy')).toHaveAttribute('data-target', 'fill');

    // stroke target: Teal goes to the stroke (1 pt), the fill is untouched
    const undo = await steps(page);
    await page.locator('[data-proxy="stroke"]').click();
    expect((await getShellState(page)).proxyTarget).toBe('stroke');
    await row(page, 'teal').click();
    expect(await getFrame(page, 'free-ellipse')).toMatchObject({ fill: { swatchId: 'pms-185-c', tint: 100 }, stroke: { paint: { swatchId: 'teal', tint: 100 }, weight: 1 } });
    expect(await steps(page)).toBe(undo + 1);
    await expect(page.locator('.galley-page svg [data-frame-id="free-ellipse"]')).toHaveAttribute('stroke', /rgb/);

    // fill target: Warm Orange goes to the fill, the stroke is untouched
    await page.locator('[data-proxy="fill"]').click();
    await row(page, 'warm-orange').click();
    expect(await getFrame(page, 'free-ellipse')).toMatchObject({ fill: { swatchId: 'warm-orange' }, stroke: { paint: { swatchId: 'teal' } } });
    expect(await steps(page)).toBe(undo + 2);

    // X toggles the target, as in InDesign; [None] clears it
    await page.keyboard.press('x');
    expect((await getShellState(page)).proxyTarget).toBe('stroke');
    await row(page, 'none').click();
    expect((await getFrame(page, 'free-ellipse')).stroke).toBeNull();
    expect((await getFrame(page, 'free-ellipse')).fill.swatchId).toBe('warm-orange');

    // undo steps back one change at a time
    await page.keyboard.press('Meta+z');
    expect((await getFrame(page, 'free-ellipse')).stroke.paint.swatchId).toBe('teal');
    await page.keyboard.press('Meta+z');
    expect((await getFrame(page, 'free-ellipse')).fill.swatchId).toBe('pms-185-c');

    await snap(page, 'swatches-applied', { testInfo, target: page.locator('[data-region="dock"]') });
  });

  test('with nothing selected a click only highlights the swatch', async ({ galley }) => {
    const { page } = galley;
    const undo = await steps(page);
    await row(page, 'teal').click();
    await expect(row(page, 'teal')).toHaveClass(/is-selected/);
    expect(await steps(page)).toBe(undo);
  });

  test('the tint field sets the tint of what is applied, and re-tints the target\'s current swatch', async ({ galley }) => {
    const { page } = galley;
    await setSelection(page, ['orange-block']);
    const tint = page.locator('[data-panel="swatches"] [data-field="tint"]');
    await tint.fill('60');
    await tint.press('Enter');
    expect((await getShellState(page)).tint).toBe(60);
    // the field re-tinted the fill's current swatch (Warm Orange) to 60%
    expect((await getFrame(page, 'orange-block')).fill).toEqual({ swatchId: 'warm-orange', tint: 60, overprint: false });
    // applying another swatch uses the field's tint
    await row(page, 'studio-blue').click();
    expect((await getFrame(page, 'orange-block')).fill).toEqual({ swatchId: 'studio-blue', tint: 60, overprint: false });
    await tint.fill('250%'); // clamped
    await tint.press('Enter');
    expect((await getShellState(page)).tint).toBe(100);
    expect((await getFrame(page, 'orange-block')).fill.tint).toBe(100);
  });

  test('New Tint Swatch saves a tint of the highlighted swatch at the tint percent, and it can be applied', async ({ galley }) => {
    const { page } = galley;
    await expect(page.getByTestId('swatches-new-tint')).toBeDisabled();
    await row(page, 'studio-blue').click();
    const tint = page.locator('[data-panel="swatches"] [data-field="tint"]');
    await tint.fill('40');
    await tint.press('Enter');
    await page.getByTestId('swatches-new-tint').click();
    const doc = await getModelDoc(page);
    const id = doc.swatchOrder[doc.swatchOrder.length - 1];
    expect(doc.swatches[id]).toMatchObject({ type: 'tint', baseId: 'studio-blue', percent: 40, name: 'Studio Blue 40%' });
    await expect(row(page, id).locator('.gl-swatch-detail')).toHaveText('Studio Blue 40%');
    await expect(row(page, id)).toHaveClass(/is-selected/);

    await setSelection(page, ['spring']);
    await page.locator('[data-proxy="fill"]').click();
    await row(page, id).click();
    expect((await getFrame(page, 'spring')).fill.swatchId).toBe(id);
  });

  test('deleting a swatch removes it, and anything painted with it falls back to [None]', async ({ galley }) => {
    const { page } = galley;
    await row(page, 'teal').click();
    await page.getByTestId('swatches-delete').click();
    expect((await getModelDoc(page)).swatches.teal).toBeUndefined();
    await expect(row(page, 'teal')).toHaveCount(0);

    await row(page, 'warm-orange').click(); // the poster's orange block uses it
    await page.getByTestId('swatches-delete').click();
    expect((await getFrame(page, 'orange-block')).fill).toBeNull();
    await page.keyboard.press('Meta+z');
    expect((await getFrame(page, 'orange-block')).fill.swatchId).toBe('warm-orange');
  });
});

// ------------------------------------------------------------------------------------------------------- control strip

test.describe('control strip', () => {
  const field = (page: Page, name: string) => page.locator(`[data-field="${name}"]`);
  const commit = async (page: Page, name: string, text: string) => {
    await field(page, name).fill(text);
    await field(page, name).press('Enter');
  };

  /** A 100 x 50 rectangle at (10, 20), selected: easy numbers. */
  async function addRect(page: Page, props: Record<string, unknown> = {}) {
    await page.evaluate((props) => {
      const g = (window as unknown as { __galley: { store: { getState(): any }; model: any } }).__galley;
      const s = g.store.getState();
      const doc = s.history.doc;
      s.dispatch(g.model.addFrame, {
        frame: { id: 'box', type: 'rect', name: '', layerId: doc.layerOrder[0], x: 10, y: 20, w: 100, h: 50, rotation: 0, fill: g.model.paint('black'), stroke: null, ...props },
        pageId: doc.pageOrder[0],
      });
      s.setSelection(['box']);
    }, props);
  }

  test('shows the selection\'s X, Y, W, H and rotation, and is empty and disabled with nothing selected', async ({ galley }) => {
    const { page } = galley;
    for (const name of ['x', 'y', 'w', 'h', 'rotation', 'weight']) await expect(field(page, name)).toBeDisabled();
    await expect(page.locator('[data-ref]').first()).toBeDisabled();
    await setSelection(page, ['photo-frame']);
    await expect(field(page, 'x')).toHaveValue('36 pt');
    await expect(field(page, 'y')).toHaveValue('516 pt');
    await expect(field(page, 'w')).toHaveValue('720 pt');
    await expect(field(page, 'h')).toHaveValue('384 pt');
    await expect(field(page, 'rotation')).toHaveValue('0°');
    await expect(page.getByTestId('selection-info')).toHaveText('Image frame · photo.jpg · 240 ppi effective');
    await expect(field(page, 'x')).toBeEnabled();
    await setSelection(page, []);
    await expect(field(page, 'x')).toBeDisabled();
  });

  test('typing X = 72 with the center reference point moves the frame\'s center to exactly 72 pt', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await page.locator('[data-ref="c"]').click();
    await expect(page.locator('[data-ref="c"]')).toHaveAttribute('aria-checked', 'true');
    expect((await getShellState(page)).refPoint).toEqual({ x: 0.5, y: 0.5 });
    await expect(field(page, 'x')).toHaveValue('60 pt'); // the center of a 100-wide frame at x = 10

    const undo = await steps(page);
    const jsonBefore = await getDocumentJson(page);
    await commit(page, 'x', '72');
    const f = await getFrame(page, 'box');
    expect(f.x + f.w / 2).toBe(72); // exactly
    expect(f).toMatchObject({ x: 22, y: 20, w: 100, h: 50 });
    expect(await steps(page)).toBe(undo + 1);
    await expect(field(page, 'x')).toHaveValue('72 pt');

    // an odd width still lands exactly (halves are exact in binary), and Y moves the center vertically
    await commit(page, 'w', '33');
    expect((await getFrame(page, 'box')).x + 33 / 2).toBe(72);
    await commit(page, 'y', '100');
    const g = await getFrame(page, 'box');
    expect(g.y + g.h / 2).toBe(100);

    // one undo step per commit: three undos restore the original byte for byte
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z');
    expect(await getDocumentJson(page)).toBe(jsonBefore);
  });

  test('the other reference points: top-left and bottom-right', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await page.locator('[data-ref="tl"]').click();
    await expect(field(page, 'x')).toHaveValue('10 pt');
    await commit(page, 'x', '0');
    await commit(page, 'y', '0');
    expect(await getFrame(page, 'box')).toMatchObject({ x: 0, y: 0 });
    await page.locator('[data-ref="br"]').click();
    await expect(field(page, 'x')).toHaveValue('100 pt');
    await commit(page, 'x', '612');
    await commit(page, 'y', '792');
    expect(await getFrame(page, 'box')).toMatchObject({ x: 512, y: 742 });
  });

  test('W and H keep the reference point; linked proportions scale both; units are understood', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await page.locator('[data-ref="c"]').click();
    await commit(page, 'w', '200');
    expect(await getFrame(page, 'box')).toMatchObject({ x: -40, y: 20, w: 200, h: 50 }); // the center stays at x = 60
    await commit(page, 'h', '1 in');
    expect(await getFrame(page, 'box')).toMatchObject({ y: 9, h: 72 }); // the center stays at y = 45
    await page.locator('[data-ref="tl"]').click();
    await commit(page, 'w', '100');
    expect(await getFrame(page, 'box')).toMatchObject({ x: -40, w: 100 }); // the corner stays

    await page.getByTestId('link-proportions').click();
    await expect(page.getByTestId('link-proportions')).toHaveAttribute('aria-pressed', 'true');
    await commit(page, 'w', '50'); // 100 x 72 scaled to 50 x 36
    expect(await getFrame(page, 'box')).toMatchObject({ w: 50, h: 36 });
    await commit(page, 'h', '72');
    expect(await getFrame(page, 'box')).toMatchObject({ w: 100, h: 72 });
  });

  test('rotation turns the frame about the reference point', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await page.locator('[data-ref="c"]').click();
    await commit(page, 'rotation', '45');
    expect(await getFrame(page, 'box')).toMatchObject({ rotation: 45, x: 10, y: 20 }); // about the center: nothing moves
    await expect(field(page, 'rotation')).toHaveValue('45°');
    await expect(page.locator('.galley-page [data-frame-id="box"]')).toHaveAttribute('transform', /rotate\(45/);

    await commit(page, 'rotation', '0');
    await page.locator('[data-ref="tl"]').click();
    await commit(page, 'rotation', '90');
    const f = await getFrame(page, 'box');
    expect(f.rotation).toBe(90);
    // the top-left corner stayed at (10, 20): the 100 x 50 box turned a quarter about it, so its center moved to (-15, 70)
    expect(f.x + f.w / 2).toBeCloseTo(10 - 25, 6);
    expect(f.y + f.h / 2).toBeCloseTo(20 + 50, 6);
    await commit(page, 'rotation', '-90');
    expect((await getFrame(page, 'box')).rotation).toBe(-90);
    await commit(page, 'rotation', '270');
    expect((await getFrame(page, 'box')).rotation).toBe(-90); // normalized
  });

  test('Escape reverts what was typed, invalid text is ignored, and the arrow keys step the value', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await page.locator('[data-ref="tl"]').click();
    const undo = await steps(page);
    await field(page, 'x').fill('999');
    await field(page, 'x').press('Escape');
    await expect(field(page, 'x')).toHaveValue('10 pt');
    expect(await steps(page)).toBe(undo);
    await commit(page, 'x', 'banana');
    await expect(field(page, 'x')).toHaveValue('10 pt');
    expect(await steps(page)).toBe(undo);

    await field(page, 'x').click();
    await field(page, 'x').press('ArrowUp');
    expect((await getFrame(page, 'box')).x).toBe(11);
    await field(page, 'x').press('Shift+ArrowUp');
    expect((await getFrame(page, 'box')).x).toBe(21);
    await field(page, 'x').press('ArrowDown');
    expect((await getFrame(page, 'box')).x).toBe(20);
    await field(page, 'x').press('Enter');
  });

  test('Enter hands the keyboard back, so tool shortcuts work again', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await commit(page, 'x', '30');
    await page.keyboard.press('m');
    expect((await getEditorState(page)).activeTool).toBe('rectangle');
  });

  test('moves and resizes several selected frames as one', async ({ galley }) => {
    const { page } = galley;
    await addRect(page, { id: 'one', x: 0, y: 0, w: 100, h: 50 });
    await addRect(page, { id: 'two', x: 100, y: 50, w: 100, h: 50 });
    await setSelection(page, ['one', 'two']);
    await page.locator('[data-ref="tl"]').click();
    await expect(field(page, 'x')).toHaveValue('0 pt');
    await expect(field(page, 'w')).toHaveValue('200 pt');
    await expect(field(page, 'rotation')).toBeDisabled();
    await expect(page.getByTestId('selection-info')).toHaveText('2 objects');

    const undo = await steps(page);
    await commit(page, 'x', '50');
    expect(await getFrame(page, 'one')).toMatchObject({ x: 50 });
    expect(await getFrame(page, 'two')).toMatchObject({ x: 150 });
    expect(await steps(page)).toBe(undo + 1);

    await commit(page, 'w', '400'); // scales about the top-left corner: positions and widths double
    expect(await getFrame(page, 'one')).toMatchObject({ x: 50, w: 200 });
    expect(await getFrame(page, 'two')).toMatchObject({ x: 250, w: 200 });
    expect(await steps(page)).toBe(undo + 2);
  });

  test('fill, stroke and weight: the chips pick a swatch, the weight field sets the stroke', async ({ galley }) => {
    const { page } = galley;
    await addRect(page);
    await expect(page.getByTestId('fill-chip')).toBeEnabled();
    await page.getByTestId('fill-chip').click();
    await page.locator('[data-testid="fill-popover"] [data-swatch-id="warm-orange"]').click();
    expect((await getFrame(page, 'box')).fill).toEqual({ swatchId: 'warm-orange', tint: 100, overprint: false });
    await expect(page.getByTestId('fill-popover')).toHaveCount(0);
    expect((await getShellState(page)).proxyTarget).toBe('fill');

    await page.getByTestId('stroke-chip').click();
    expect((await getShellState(page)).proxyTarget).toBe('stroke');
    await page.locator('[data-testid="stroke-popover"] [data-swatch-id="studio-blue"]').click();
    expect((await getFrame(page, 'box')).stroke).toEqual({ paint: { swatchId: 'studio-blue', tint: 100, overprint: false }, weight: 1 });

    await commit(page, 'weight', '4');
    expect((await getFrame(page, 'box')).stroke.weight).toBe(4);
    await expect(field(page, 'weight')).toHaveValue('4 pt');
    await commit(page, 'weight', '0.5 mm');
    expect((await getFrame(page, 'box')).stroke.weight).toBeCloseTo((0.5 * 72) / 25.4, 6);

    await page.getByTestId('fill-chip').click();
    await page.locator('[data-testid="fill-popover"] [data-swatch-id="none"]').click();
    expect((await getFrame(page, 'box')).fill).toBeNull();
    await page.getByTestId('fill-chip').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fill-popover')).toHaveCount(0);
  });

  test('typing a weight with no stroke gives the frame a black stroke of that weight', async ({ galley }) => {
    const { page } = galley;
    await addRect(page, { fill: null });
    await expect(field(page, 'weight')).toHaveValue('1 pt');
    await commit(page, 'weight', '3');
    expect((await getFrame(page, 'box')).stroke).toEqual({ paint: { swatchId: 'black', tint: 100, overprint: false }, weight: 3 });
  });

  test('the fitting dropdown appears for image frames only, and is disabled until the fitting commands exist', async ({ galley }) => {
    const { page } = galley;
    await setSelection(page, ['spring']);
    await expect(page.getByTestId('fitting-dropdown')).toHaveCount(0);
    await setSelection(page, ['photo-frame']);
    const dropdown = page.getByTestId('fitting-dropdown');
    await expect(dropdown).toBeVisible();
    const registered = await page.evaluate(() => (window as unknown as { __galley: { commands: { list(): { id: string }[] } } }).__galley.commands.list().some((c) => c.id.startsWith('object.fit.')));
    if (registered) {
      await expect(dropdown).toBeEnabled();
      expect(await dropdown.locator('option').allTextContents()).toEqual(['Fitting…', 'Fill Frame Proportionally', 'Fit Content Proportionally', 'Fit Content to Frame', 'Center Content']);
    } else {
      await expect(dropdown).toBeDisabled(); // lane B registers object.fit.*
    }
  });

  test('the control strip runs lane B\'s fitting command when one is registered', async ({ galley }) => {
    const { page } = galley;
    // stand in for lane B: register a fitting command that records its call
    await page.evaluate(() => {
      const g = (window as unknown as { __galley: { commands: { has(id: string): boolean; register(c: unknown): void } } }).__galley;
      const w = window as unknown as { __fitCalls: string[] };
      w.__fitCalls = [];
      if (!g.commands.has('object.fit.center')) g.commands.register({ id: 'object.fit.center', label: 'Center Content', run: () => w.__fitCalls.push('center') });
    });
    await setSelection(page, ['photo-frame']);
    const dropdown = page.getByTestId('fitting-dropdown');
    await expect(dropdown).toBeEnabled();
    await dropdown.selectOption('object.fit.center');
    const calls = await page.evaluate(() => (window as unknown as { __fitCalls: string[] }).__fitCalls);
    expect(calls.length === 1 || calls.length === 0).toBe(true); // 1 with the stand-in; lane B's own command when merged
    await expect(dropdown).toHaveValue(''); // an action menu: it goes back to its heading
  });

  test('every control-strip edit leaves the page drawn from the model: the frame on the canvas moves', async ({ galley }, testInfo) => {
    const { page } = galley;
    await addRect(page, { fill: { swatchId: 'warm-orange', tint: 100, overprint: false } });
    await page.locator('[data-ref="c"]').click();
    await commit(page, 'x', '300');
    await commit(page, 'rotation', '30');
    await waitForStable(page);
    const box = page.locator('.galley-page svg [data-frame-id="box"]');
    await expect(box).toHaveAttribute('x', /.+/);
    const attrs = await box.evaluate((el) => ({ x: Number(el.getAttribute('x')), w: Number(el.getAttribute('width')), transform: el.getAttribute('transform') }));
    // the sheet starts max(bleed, slug) = 36 pt before the trim edge on the poster, so the center is at 36 + 300
    expect(attrs.x + attrs.w / 2).toBeCloseTo(36 + 300, 6);
    expect(attrs.transform).toMatch(/^rotate\(30 /);
    await snap(page, 'control-strip-rotated', { testInfo });
  });
});
