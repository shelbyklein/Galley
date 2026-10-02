import { FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState, runCommand } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';
import { dragPage, dragScreen, flushInput, getDoc, getView, loadDoc, pageToScreen, screenToPage, setTool, viewportBox } from './helpers';

// P1-08: viewport and rulers: zoom (⌘=, ⌘−, ⌘0, zoom tool), pan (space-drag, hand tool), rulers in pt/in/mm, guides dragged
// from the rulers, and margin, column, bleed and slug guides.

test.describe('blank Letter document', () => {
  test.use({ open: null });

  test('⌘0 fits the page; ⌘= and ⌘− step through the zoom presets; ⌘1 is actual size', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    const box = await viewportBox(page);
    expect(box.width).toBe(1078); // 1440 - tools 44 - dock 300 - ruler 18
    expect(box.height).toBe(782); // 900 - titlebar 28 - control 44 - status 28 - ruler 18

    const zoom = async () => (await getEditorState(page)).viewport.zoom;
    const label = () => page.getByTestId('canvas').getAttribute('data-zoom-label');

    // a new document is fitted: the 612 x 792 page in 1078 x 782 with 24 px padding
    const fit = (782 - 48) / 792;
    expect(await zoom()).toBeCloseTo(fit, 6);
    expect((await getEditorState(page)).viewport.fit).toBe(true);
    expect(await label()).toBe('92.7%');

    await page.keyboard.press('Meta+1');
    expect(await zoom()).toBe(1);
    expect(await label()).toBe('100%');
    expect((await getEditorState(page)).viewport.fit).toBe(false);

    await page.keyboard.press('Meta+=');
    expect(await zoom()).toBe(1.25);
    await page.keyboard.press('Meta+=');
    expect(await zoom()).toBe(1.5);
    await page.keyboard.press('Meta+-');
    await page.keyboard.press('Meta+-');
    expect(await zoom()).toBe(1);
    await page.keyboard.press('Meta+-');
    expect(await zoom()).toBe(0.75);

    // ⌘0 fits the page again, and ⌘= from there goes to the next preset above the fit zoom
    await page.keyboard.press('Meta+0');
    expect(await zoom()).toBeCloseTo(fit, 6);
    expect((await getEditorState(page)).viewport.fit).toBe(true);
    await page.keyboard.press('Meta+=');
    expect(await zoom()).toBe(1);
    expect(await label()).toBe('100%');
    await page.keyboard.press('Meta+=');
    expect(await zoom()).toBe(1.25);
  });

  test('zooming keeps the center of the view where it is; the fit follows the window until you zoom', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+0');
    const box = await viewportBox(page);
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const before = await screenToPage(page, center);
    await page.keyboard.press('Meta+=');
    await page.keyboard.press('Meta+=');
    const after = await screenToPage(page, center);
    // keyboard zoom rounds the pan to whole pixels, so the center moves by at most half a pixel (half a point at 100%)
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);

    // fitted: the window resizes, the page stays fitted
    await page.keyboard.press('Meta+0');
    await galley.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800));
    await expect.poll(async () => (await getEditorState(page)).viewport.zoom).toBeCloseTo((800 - 28 - 44 - 28 - 18 - 48) / 792, 3);
    expect((await getEditorState(page)).viewport.fit).toBe(true);
  });

  test('space-drag pans the view, and so does the hand tool', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+1');
    const before = (await getEditorState(page)).viewport;
    const box = await viewportBox(page);
    const start = { x: box.left + 400, y: box.top + 300 };

    await page.keyboard.down('Space');
    await dragScreen(page, start, { x: start.x + 120, y: start.y + 45 });
    await page.keyboard.up('Space');
    const moved = (await getEditorState(page)).viewport;
    expect(moved.panX).toBe(before.panX + 120);
    expect(moved.panY).toBe(before.panY + 45);
    expect(moved.zoom).toBe(1);
    expect(moved.fit).toBe(false);
    // panning is not a document change
    expect((await getEditorState(page)).undoSteps).toBe(0);

    await setTool(page, 'hand');
    await dragScreen(page, start, { x: start.x - 30, y: start.y - 70 });
    const hand = (await getEditorState(page)).viewport;
    expect(hand.panX).toBe(moved.panX - 30);
    expect(hand.panY).toBe(moved.panY - 70);
  });

  test('the zoom tool: click zooms in at the point, alt-click out, a drag zooms to the rectangle', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+1');
    await setTool(page, 'zoom');
    const target = await pageToScreen(page, { x: 306, y: 200 });
    const under = await screenToPage(page, target);

    await page.mouse.click(target.x, target.y);
    await flushInput(page);
    let v = (await getEditorState(page)).viewport;
    expect(v.zoom).toBe(1.25);
    const stillUnder = await screenToPage(page, target);
    expect(stillUnder.x).toBeCloseTo(under.x, 3);
    expect(stillUnder.y).toBeCloseTo(under.y, 3);

    await page.keyboard.down('Alt');
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up('Alt');
    await flushInput(page);
    v = (await getEditorState(page)).viewport;
    expect(v.zoom).toBe(1);

    // a marquee fits the rectangle in the view
    await dragPage(page, { x: 100, y: 100 }, { x: 300, y: 250 });
    v = (await getEditorState(page)).viewport;
    const box = await viewportBox(page);
    expect(v.zoom).toBeCloseTo(Math.min((box.width - 24) / 200, (box.height - 24) / 150), 4);
    expect((await getEditorState(page)).undoSteps).toBe(0);
  });

  test('pinch (ctrl + wheel) zooms about the pointer; two-finger scroll pans', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+1');
    const box = await viewportBox(page);
    const at = { x: box.left + 500, y: box.top + 400 };
    const under = await screenToPage(page, at);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -50);
    await page.keyboard.up('Control');
    await flushInput(page);
    const zoomed = (await getEditorState(page)).viewport;
    expect(zoomed.zoom).toBeCloseTo(Math.exp(0.5), 6);
    const still = await screenToPage(page, at);
    expect(still.x).toBeCloseTo(under.x, 4);
    expect(still.y).toBeCloseTo(under.y, 4);

    await page.mouse.wheel(30, 40);
    await flushInput(page);
    const panned = (await getEditorState(page)).viewport;
    expect(panned.panX).toBeCloseTo(zoomed.panX - 30, 6);
    expect(panned.panY).toBeCloseTo(zoomed.panY - 40, 6);
  });

  test('a guide dragged from the top ruler lands where it is dropped (±0.5 pt at 100%) and is one undo step', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page);
    await page.keyboard.press('Meta+1');
    const before = await getDocumentJson(page);

    const ruler = await page.getByTestId('ruler-top').boundingBox();
    const from = { x: ruler!.x + 300, y: ruler!.y + 9 };
    const drop = await pageToScreen(page, { x: 250, y: 217 });
    await dragScreen(page, from, { x: drop.x, y: drop.y }, { steps: 12 });

    const doc = await getDoc(page);
    const guides = Object.values<any>(doc.guides);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: 'horizontal', pageId: 'page_1' });
    expect(Math.abs(guides[0].position - 217)).toBeLessThanOrEqual(0.5);
    expect((await getEditorState(page)).undoSteps).toBe(1);
    await expect(page.locator('[data-guide-id]')).toHaveCount(1);
    const line = await page.locator('[data-guide-id]').boundingBox();
    expect(Math.abs(line!.y - drop.y)).toBeLessThanOrEqual(1);

    // from the left ruler: a vertical guide
    const left = await page.getByTestId('ruler-left').boundingBox();
    const drop2 = await pageToScreen(page, { x: 123.5, y: 400 });
    await dragScreen(page, { x: left!.x + 9, y: left!.y + 200 }, drop2, { steps: 12 });
    const vertical = Object.values<any>((await getDoc(page)).guides).find((g) => g.orientation === 'vertical');
    expect(Math.abs(vertical.position - 123.5)).toBeLessThanOrEqual(0.5);
    expect((await getEditorState(page)).undoSteps).toBe(2);

    // undo takes the last guide away, undoing again restores the document byte for byte
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    expect(await getDocumentJson(page)).toBe(before);
  });

  test('pressing a ruler and releasing on it makes no guide; dropping a guide back on its ruler deletes it', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page, { guides: [['vertical', 100]] });
    await page.keyboard.press('Meta+1');
    const ruler = await page.getByTestId('ruler-top').boundingBox();
    await page.mouse.click(ruler!.x + 200, ruler!.y + 9);
    await flushInput(page);
    expect(Object.keys((await getDoc(page)).guides)).toEqual(['guide_1']);
    expect((await getEditorState(page)).undoSteps).toBe(0);

    // move the existing guide (selection tool), one undo step
    const at = await pageToScreen(page, { x: 100, y: 300 });
    await dragScreen(page, at, { x: at.x + 50, y: at.y });
    expect((await getDoc(page)).guides.guide_1.position).toBeCloseTo(150, 0);
    expect((await getEditorState(page)).undoSteps).toBe(1);

    // drag it back onto the left ruler: gone
    const moved = await pageToScreen(page, { x: 150, y: 300 });
    const left = await page.getByTestId('ruler-left').boundingBox();
    await dragScreen(page, moved, { x: left!.x + 9, y: moved.y });
    expect((await getDoc(page)).guides).toEqual({});
    expect((await getEditorState(page)).undoSteps).toBe(2);
    await page.keyboard.press('Meta+z');
    expect((await getDoc(page)).guides.guide_1.position).toBeCloseTo(150, 0);
  });

  test('rulers show the chosen units, and ⌘R and ⌘; hide rulers and guides', async ({ galley }) => {
    const { page } = galley;
    await loadDoc(page, { guides: [['horizontal', 300]] });
    await page.keyboard.press('Meta+1');
    const top = page.getByTestId('ruler-top');
    const labels = async () => (await top.getAttribute('data-labels'))!.split(' ');

    expect((await getView(page)).view.units).toBe('pt');
    // 100%: a major tick every 100 pt, labelled in points
    expect(await labels()).toEqual(expect.arrayContaining(['0', '100', '200', '300']));
    expect(await top.getAttribute('data-units')).toBe('pt');

    await runCommand(page, 'view.units.in');
    expect(await top.getAttribute('data-units')).toBe('in');
    expect(await labels()).toEqual(expect.arrayContaining(['0', '1', '2', '3', '4', '5', '6', '7', '8']));
    expect(await labels()).not.toContain('100');
    expect(await page.getByTestId('ruler-left').getAttribute('data-units')).toBe('in');

    await runCommand(page, 'view.units.mm');
    expect(await top.getAttribute('data-units')).toBe('mm');
    expect(await labels()).toEqual(expect.arrayContaining(['0', '20', '40', '60', '80', '100', '120', '140', '160', '180', '200']));

    await runCommand(page, 'view.units.pt');
    await expect(page.locator('[data-guide-id]')).toHaveCount(1);
    await page.keyboard.press('Meta+;');
    await expect(page.locator('[data-guide-id]')).toHaveCount(0);
    await expect(page.locator('[data-guide-kind]')).toHaveCount(0);
    await page.keyboard.press('Meta+;');
    await expect(page.locator('[data-guide-id]')).toHaveCount(1);

    await page.keyboard.press('Meta+r');
    await expect(page.getByTestId('ruler-top')).toHaveCount(0);
    expect((await viewportBox(page)).width).toBe(1096);
    await page.keyboard.press('Meta+r');
    await expect(page.getByTestId('ruler-top')).toHaveCount(1);
    expect((await viewportBox(page)).width).toBe(1078);
  });
});

test.describe('poster fixture', () => {
  test.use({ open: FIXTURES.posterBasic });

  test('margin, column, bleed and slug guides and a ruler guide are drawn over the page', async ({ galley }, testInfo) => {
    const { page } = galley;
    await page.waitForSelector('.galley-page[data-ready="true"]');
    await expect(page.locator('[data-guide-kind="margin"]')).toHaveCount(1);
    await expect(page.locator('[data-guide-kind="bleed"]')).toHaveCount(1);
    await expect(page.locator('[data-guide-kind="slug"]')).toHaveCount(1);
    await expect(page.locator('[data-guide-kind="column"]')).toHaveCount(4); // 3 columns: 2 gutters, 2 lines each
    await expect(page.locator('[data-guide-id="guide_1"]')).toHaveCount(1);

    // the margin guide sits on the document's margins: 36 pt in from the trim edge
    const zoom = (await getEditorState(page)).viewport.zoom;
    const margin = await page.locator('[data-guide-kind="margin"]').boundingBox();
    const trim = await pageToScreen(page, { x: 0, y: 0 });
    expect(Math.abs(margin!.x - (trim.x + 36 * zoom))).toBeLessThanOrEqual(1);
    expect(Math.abs(margin!.y - (trim.y + 36 * zoom))).toBeLessThanOrEqual(1);

    await snap(page, 'guides', { testInfo });
    await expectBaseline(page, 'guides');
  });
});
