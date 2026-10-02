import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';
import { dragPage, dragScreen, flushInput, getFrame, loadDoc, setSelection, setTool, type FrameSpec } from './helpers';

// P1-11: smart guides and snapping: guides, margins, columns, page edges, bleed, and object edges and centers, with a
// screen-pixel threshold; smart guide lines show while dragging.

test.use({ open: null });

const FRAMES: FrameSpec[] = [
  { id: 'a', type: 'rect', x: 100, y: 100, w: 100, h: 80 },
  { id: 'b', type: 'rect', x: 400, y: 300, w: 60, h: 60 },
];

async function setup(page: Page, spec: Parameters<typeof loadDoc>[1] = { frames: FRAMES }) {
  await loadDoc(page, spec);
  await page.keyboard.press('Meta+1');
}

/** Zoom to 200% (⌘1, then three steps up: 125, 150, 200). */
async function zoom200(page: Page) {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+=');
  expect((await getEditorState(page)).viewport.zoom).toBe(2);
}

test('a frame dragged to within 3 screen px of a margin lands exactly on it', async ({ galley }) => {
  const { page } = galley;
  await setup(page);
  const before = await getDocumentJson(page);
  // grab the frame at its middle (150, 140); its left edge is 100: drag so the left edge ends at 36 + 3 = 39 (3 px at 100%)
  await dragPage(page, { x: 150, y: 140 }, { x: 89, y: 140 });
  expect((await getFrame(page, 'a')).x).toBe(36); // exactly the margin, not 39
  expect(await getFrame(page, 'a')).toMatchObject({ y: 100 });
  expect((await getEditorState(page)).undoSteps).toBe(1);
  await page.keyboard.press('Meta+z');
  expect(await getDocumentJson(page)).toBe(before);
});

test('the threshold is in screen pixels: 3 px snaps and 6 px does not, at 100% and at 200%', async ({ galley }) => {
  const { page } = galley;
  // the frame sits where it stays in view at 200%, which centers on the page's middle
  await setup(page, { frames: [{ id: 'a', type: 'rect', x: 100, y: 350, w: 100, h: 80 }] });
  for (const level of [1, 2]) {
    if (level === 2) await zoom200(page);
    const z = (await getEditorState(page)).viewport.zoom;
    // left edge 3 screen px off the left margin: snaps
    await dragPage(page, { x: 150, y: 390 }, { x: 150 - (100 - 36 - 3 / z), y: 390 });
    expect((await getFrame(page, 'a')).x).toBe(36);
    await page.keyboard.press('Meta+z');
    // 6 screen px off: stays where it was dropped
    await dragPage(page, { x: 150, y: 390 }, { x: 150 - (100 - 36 - 6 / z), y: 390 });
    const x = (await getFrame(page, 'a')).x;
    expect(x).toBeCloseTo(36 + 6 / z, 3);
    expect(x).not.toBe(36);
    await page.keyboard.press('Meta+z');
  }
});

test('snaps to the right margin, the page edge, the page center and a column', async ({ galley }) => {
  const { page } = galley;
  await setup(page, { page: { columns: { count: 2, gutter: 20 } }, frames: FRAMES });
  const right = async (x: number) => {
    await dragPage(page, { x: 150, y: 140 }, { x: 150 + (x - 100), y: 140 });
    const f = await getFrame(page, 'a');
    await page.keyboard.press('Meta+z');
    return f;
  };
  // right margin: 612 - 36 = 576; the frame's right edge (x + 100) goes there when x is near 476
  expect((await right(474)).x).toBe(476);
  // the page's right edge, 612: x = 512
  expect((await right(510)).x + 100).toBe(612);
  // the page center, 306: the frame's center (x + 50)
  expect((await right(254)).x + 50).toBe(306);
  // columns: content 540 wide, gutter 20 -> columns of 260: [36, 296] and [316, 576]; the left edge snaps to 316
  expect((await right(313)).x).toBe(316);
});

test('snaps to a ruler guide with the left edge, the right edge or the center', async ({ galley }) => {
  const { page } = galley;
  await setup(page, { frames: FRAMES, guides: [['vertical', 250], ['horizontal', 450]] });
  const drag = async (to: { x: number; y: number }) => {
    await dragPage(page, { x: 150, y: 140 }, { x: 150 + (to.x - 100), y: 140 + (to.y - 100) });
    const f = await getFrame(page, 'a');
    await page.keyboard.press('Meta+z');
    return f;
  };
  expect((await drag({ x: 252, y: 100 })).x).toBe(250); // left edge on the guide
  expect((await drag({ x: 148, y: 100 })).x + 100).toBe(250); // right edge on the guide
  expect((await drag({ x: 202, y: 100 })).x + 50).toBe(250); // center on the guide
  expect((await drag({ x: 100, y: 447 })).y).toBe(450); // top edge on the horizontal guide
});

test('snaps to the edges and centers of other objects', async ({ galley }) => {
  const { page } = galley;
  await setup(page);
  const drag = async (to: { x: number; y: number }) => {
    await dragPage(page, { x: 150, y: 140 }, { x: 150 + (to.x - 100), y: 140 + (to.y - 100) });
    const f = await getFrame(page, 'a');
    await page.keyboard.press('Meta+z');
    return f;
  };
  // b spans x 400..460, y 300..360 (center 430, 330); a is 100 x 80
  expect((await drag({ x: 402, y: 100 })).x).toBe(400); // left edges align
  expect((await drag({ x: 358, y: 100 })).x).toBe(360); // a's right edge meets b's left edge
  expect((await drag({ x: 382, y: 100 })).x + 50).toBe(430); // centers align
  expect((await drag({ x: 100, y: 222 })).y + 80).toBe(300); // a's bottom edge meets b's top edge
  expect((await drag({ x: 100, y: 292 })).y + 40).toBe(330); // middles align
});

test('the bleed edge is a target', async ({ galley }) => {
  const { page } = galley;
  await setup(page, { page: { bleed: 9 }, frames: [{ id: 'a', type: 'rect', x: 100, y: 100, w: 100, h: 80 }] });
  await dragPage(page, { x: 150, y: 140 }, { x: 150 - 100 - 7, y: 140 }); // left edge at -7, 2 pt from the bleed edge
  expect((await getFrame(page, 'a')).x).toBe(-9);
});

test('hiding guides (⌘;) turns off margin snapping but not snapping to the page edge', async ({ galley }) => {
  const { page } = galley;
  await setup(page);
  await page.keyboard.press('Meta+;');
  await dragPage(page, { x: 150, y: 140 }, { x: 150 - 61, y: 140 }); // left edge at 39: the margin would snap it
  expect((await getFrame(page, 'a')).x).toBeCloseTo(39, 3);
  await page.keyboard.press('Meta+z');
  await dragPage(page, { x: 150, y: 140 }, { x: 150 - 98, y: 140 }); // left edge at 2: the page edge still snaps it
  expect((await getFrame(page, 'a')).x).toBe(0);
});

test('resizing snaps the dragged edge: the right edge lands exactly on the right margin', async ({ galley }) => {
  const { page } = galley;
  await setup(page);
  await setSelection(page, ['a']);
  const e = await page.locator('[data-handle="e"]').boundingBox();
  const from = { x: e!.x + e!.width / 2, y: e!.y + e!.height / 2 };
  await dragScreen(page, from, { x: from.x + (576 - 200) - 2, y: from.y }); // right edge at 574: 2 px short of the margin
  const f = await getFrame(page, 'a');
  expect(f.x + f.w).toBe(576);
  expect(f).toMatchObject({ x: 100, w: 476 });
});

test('drawing snaps the corner: a rectangle drawn near the margins starts and ends on them', async ({ galley }) => {
  const { page } = galley;
  await setup(page);
  await setTool(page, 'rectangle');
  await dragPage(page, { x: 38, y: 37 }, { x: 574, y: 300 });
  const f = await getFrame(page, (await getEditorState(page)).selection[0]!);
  expect(f).toMatchObject({ x: 36, y: 36, w: 540, h: 264 });
});

test('smart guide lines show while dragging and disappear on release (screenshot mid-drag)', async ({ galley }, testInfo) => {
  const { page } = galley;
  await setup(page, { frames: [{ id: 'a', type: 'rect', x: 100, y: 100, w: 100, h: 80 }, { id: 'b', type: 'rect', x: 400, y: 300, w: 60, h: 60 }] });
  await page.keyboard.press('Meta+0');
  // wait for Fit Page to apply before reading the zoom (reading it too early made the drag land off target under load)
  await expect.poll(async () => (await getEditorState(page)).viewport.fit).toBe(true);
  await flushInput(page);
  await expect(page.locator('.gl-smart-guide')).toHaveCount(0);

  // drag 'a' by its center until it is 2 screen px from the page center (x = 306): it snaps, and the guide shows
  const z = (await getEditorState(page)).viewport.zoom;
  await dragPage(page, { x: 150, y: 140 }, { x: 306 + 2 / z, y: 400 }, { hold: true });
  await flushInput(page);
  await expect(page.locator('.gl-smart-guide[data-axis="x"]')).toHaveCount(1);
  await expect(page.locator('.gl-smart-label')).toHaveText('center X');
  expect((await getFrame(page, 'a')).x + 50).toBe(306); // already snapped while dragging
  await snap(page, 'smart-guide', { testInfo });
  await expectBaseline(page, 'smart-guide');

  await page.mouse.up();
  await flushInput(page);
  await expect(page.locator('.gl-smart-guide')).toHaveCount(0);
  expect((await getEditorState(page)).undoSteps).toBe(1);
});
