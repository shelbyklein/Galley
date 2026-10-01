import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';
import { clickPage, dragPage, dragScreen, flushInput, getDoc, getFrame, loadDoc, pageToScreen, setSelection, type FrameSpec } from './helpers';

// P1-09: selection and transform. Every gesture is exactly one undo step: ⌘Z restores the prior document byte for byte.

test.use({ open: null });

const FRAMES: FrameSpec[] = [
  { id: 'a', type: 'rect', x: 100, y: 100, w: 100, h: 80 },
  { id: 'b', type: 'rect', x: 300, y: 100, w: 100, h: 80 },
  { id: 'c', type: 'ellipse', x: 100, y: 300, w: 120, h: 90 },
];

async function setup(page: Page, frames: FrameSpec[] = FRAMES) {
  await loadDoc(page, { frames });
  await page.keyboard.press('Meta+1'); // 100%: one screen pixel is one point
}

const selection = async (page: Page) => (await getEditorState(page)).selection;
const undoSteps = async (page: Page) => (await getEditorState(page)).undoSteps;

/**
 * Run a gesture and check it left exactly one undo step that ⌘Z takes back byte for byte (and ⇧⌘Z puts back). Returns the
 * selection the gesture left, read before the undo (undo does not restore selection).
 */
async function oneUndoStep(page: Page, gesture: () => Promise<void>): Promise<string[]> {
  const before = await getDocumentJson(page);
  const steps = await undoSteps(page);
  await gesture();
  await flushInput(page);
  expect(await undoSteps(page)).toBe(steps + 1);
  expect(await getDocumentJson(page)).not.toBe(before);
  const after = await getDocumentJson(page);
  const left = await selection(page);
  await page.keyboard.press('Meta+z');
  expect(await getDocumentJson(page)).toBe(before);
  expect(await undoSteps(page)).toBe(steps);
  await page.keyboard.press('Meta+Shift+z');
  expect(await getDocumentJson(page)).toBe(after);
  return left;
}

const handleCenter = async (page: Page, handle: string) => {
  const box = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  if (!box) throw new Error(`no ${handle} handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe('selecting', () => {
  test('click selects, shift-click adds and removes, a click on empty pasteboard clears', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await clickPage(page, { x: 150, y: 140 });
    expect(await selection(page)).toEqual(['a']);
    await clickPage(page, { x: 350, y: 140 }, ['Shift']);
    expect(await selection(page)).toEqual(['a', 'b']);
    await clickPage(page, { x: 350, y: 140 }, ['Shift']);
    expect(await selection(page)).toEqual(['a']);
    await clickPage(page, { x: 160, y: 345 }); // inside the ellipse
    expect(await selection(page)).toEqual(['c']);
    await clickPage(page, { x: 150, y: 140 });
    await clickPage(page, { x: 103, y: 303 }); // the ellipse's bounding-box corner is not on the ellipse
    expect(await selection(page)).toEqual([]);
    // selecting is not a document change
    expect(await undoSteps(page)).toBe(0);
    await expect(page.locator('[data-selected-id]')).toHaveCount(0);
  });

  test('pressing one of several selected objects selects just it when it is a plain click', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'b']);
    await clickPage(page, { x: 150, y: 140 });
    expect(await selection(page)).toEqual(['a']);
  });

  test('a marquee selects what it touches; shift adds', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await dragPage(page, { x: 50, y: 50 }, { x: 250, y: 150 });
    expect(await selection(page)).toEqual(['a']);
    await dragPage(page, { x: 50, y: 50 }, { x: 450, y: 150 });
    expect(await selection(page)).toEqual(['a', 'b']);
    await dragPage(page, { x: 50, y: 250 }, { x: 150, y: 350 }, { modifiers: ['Shift'] });
    expect(await selection(page)).toEqual(['a', 'b', 'c']);
    await dragPage(page, { x: 500, y: 600 }, { x: 550, y: 650 });
    expect(await selection(page)).toEqual([]);
    expect(await undoSteps(page)).toBe(0);
  });

  test('locked and hidden layers cannot be selected', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await page.evaluate(() => {
      const g = (window as any).__galley;
      g.store.getState().dispatch(g.model.setLayerProps, { id: 'layer_1', props: { locked: true } });
    });
    await clickPage(page, { x: 150, y: 140 });
    expect(await selection(page)).toEqual([]);
    await dragPage(page, { x: 50, y: 50 }, { x: 450, y: 150 });
    expect(await selection(page)).toEqual([]);
  });

  test('select all and deselect all', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await page.keyboard.press('Meta+a');
    expect(await selection(page)).toEqual(['a', 'b', 'c']);
    await page.keyboard.press('Meta+Shift+a');
    expect(await selection(page)).toEqual([]);
  });
});

test.describe('moving', () => {
  test('dragging moves the object by the drag; one undo step', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await oneUndoStep(page, () => dragPage(page, { x: 150, y: 140 }, { x: 190, y: 175.5 }, { steps: 20 }));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 140, y: 135.5, w: 100, h: 80 });
    expect(await selection(page)).toEqual(['a']);
    // the others did not move
    expect(await getFrame(page, 'b')).toMatchObject({ x: 300, y: 100 });
  });

  test('dragging an unselected object selects it and moves only it; dragging a selection moves all of it', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'b']);
    await oneUndoStep(page, () => dragPage(page, { x: 350, y: 140 }, { x: 350, y: 240 }));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 100, y: 200 });
    expect(await getFrame(page, 'b')).toMatchObject({ x: 300, y: 200 });
  });

  test('shift constrains the drag to one axis', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await dragPage(page, { x: 150, y: 140 }, { x: 230, y: 170 }, { modifiers: ['Shift'] });
    expect(await getFrame(page, 'a')).toMatchObject({ x: 180, y: 100 });
  });

  test('arrow keys move 1 pt, shift+arrow 10 pt, one undo step each press', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    await oneUndoStep(page, () => page.keyboard.press('ArrowRight'));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 101, y: 100 });
    await oneUndoStep(page, () => page.keyboard.press('Shift+ArrowDown'));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 101, y: 110 });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    expect(await getFrame(page, 'a')).toMatchObject({ x: 100, y: 109 });
  });

  test('alt-drag drags a copy and leaves the original; one undo step', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    const left = await oneUndoStep(page, () => dragPage(page, { x: 150, y: 140 }, { x: 150, y: 250 }, { modifiers: ['Alt'] }));
    const doc = await getDoc(page);
    expect(doc.pages.page_1.items).toHaveLength(4);
    expect(doc.frames.a).toMatchObject({ x: 100, y: 100 });
    const copy = Object.values<any>(doc.frames).find((f) => f.id !== 'a' && f.x === 100 && f.y === 210);
    expect(copy).toMatchObject({ type: 'rect', w: 100, h: 80 });
    expect(left).toEqual([copy.id]); // the copy was the selection while dragging
  });

  test('Escape during a drag cancels it', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    const before = await getDocumentJson(page);
    const from = await pageToScreen(page, { x: 150, y: 140 });
    const to = await pageToScreen(page, { x: 250, y: 240 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    expect((await getFrame(page, 'a')).x).toBe(200);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await getDocumentJson(page)).toBe(before);
    expect(await undoSteps(page)).toBe(0);
  });
});

test.describe('resizing and rotating', () => {
  test('dragging a corner handle resizes about the opposite corner', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    const se = await handleCenter(page, 'se');
    await oneUndoStep(page, () => dragScreen(page, se, { x: se.x + 40, y: se.y + 30 }));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 100, y: 100, w: 140, h: 110 });
  });

  test('an edge handle changes one dimension', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    const w = await handleCenter(page, 'w');
    await oneUndoStep(page, () => dragScreen(page, w, { x: w.x - 25, y: w.y + 50 }));
    expect(await getFrame(page, 'a')).toMatchObject({ x: 75, y: 100, w: 125, h: 80 });
  });

  test('shift keeps the proportions; alt resizes from the center', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    const se = await handleCenter(page, 'se');
    await dragScreen(page, se, { x: se.x + 100, y: se.y + 10 }, { modifiers: ['Shift'] });
    expect(await getFrame(page, 'a')).toMatchObject({ x: 100, y: 100, w: 200, h: 160 });
    await page.keyboard.press('Meta+z');
    const nw = await handleCenter(page, 'nw');
    await dragScreen(page, nw, { x: nw.x - 20, y: nw.y - 10 }, { modifiers: ['Alt'] });
    expect(await getFrame(page, 'a')).toMatchObject({ x: 80, y: 90, w: 140, h: 100 });
  });

  test('resizing a group scales its children together', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'b']);
    await page.keyboard.press('Meta+g');
    const se = await handleCenter(page, 'se'); // the group's bounds are x 100..400, y 100..180
    await oneUndoStep(page, () => dragScreen(page, se, { x: se.x + 300, y: se.y + 80 }));
    // 300 x 80 -> 600 x 160: both children double
    expect(await getFrame(page, 'a')).toMatchObject({ x: 100, y: 100, w: 200, h: 160 });
    expect(await getFrame(page, 'b')).toMatchObject({ x: 500, y: 100, w: 200, h: 160 });
  });

  test('dragging just outside a corner rotates about the center; shift snaps to 45 degrees', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    const center = await pageToScreen(page, { x: 150, y: 140 });
    const se = await handleCenter(page, 'se');
    const grab = { x: se.x + 9, y: se.y + 9 };
    // sweep the grab point a quarter turn clockwise about the center
    const r = Math.hypot(grab.x - center.x, grab.y - center.y);
    const a0 = Math.atan2(grab.y - center.y, grab.x - center.x);
    const target = { x: center.x + r * Math.cos(a0 + Math.PI / 2), y: center.y + r * Math.sin(a0 + Math.PI / 2) };
    await oneUndoStep(page, () => dragScreen(page, grab, target, { steps: 20 }));
    const a = await getFrame(page, 'a');
    expect(a.rotation).toBeCloseTo(90, 0);
    expect(a).toMatchObject({ x: 100, y: 100, w: 100, h: 80 }); // about its own center: the box does not move

    await page.keyboard.press('Meta+z');
    const grab2 = { x: (await handleCenter(page, 'se')).x + 9, y: (await handleCenter(page, 'se')).y + 9 };
    const toward = { x: center.x + r * Math.cos(a0 + 0.69), y: center.y + r * Math.sin(a0 + 0.69) }; // about 39.5 degrees
    await dragScreen(page, grab2, toward, { modifiers: ['Shift'], steps: 10 });
    expect((await getFrame(page, 'a')).rotation).toBe(45);
  });

  test('rotating a group turns its children about the group center', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'b']);
    await page.keyboard.press('Meta+g');
    const center = await pageToScreen(page, { x: 250, y: 140 });
    const se = await handleCenter(page, 'se');
    const grab = { x: se.x + 9, y: se.y + 9 };
    const r = Math.hypot(grab.x - center.x, grab.y - center.y);
    const a0 = Math.atan2(grab.y - center.y, grab.x - center.x);
    await dragScreen(page, grab, { x: center.x + r * Math.cos(a0 + Math.PI), y: center.y + r * Math.sin(a0 + Math.PI) }, { modifiers: ['Shift'], steps: 30 });
    // half a turn about (250, 140): a (center 150,140) and b (center 350,140) swap places
    const a = await getFrame(page, 'a');
    const b = await getFrame(page, 'b');
    expect(Math.abs(a.rotation)).toBe(180);
    expect(a.x + a.w / 2).toBeCloseTo(350, 3);
    expect(b.x + b.w / 2).toBeCloseTo(150, 3);
    expect(a.y + a.h / 2).toBeCloseTo(140, 3);
  });
});

test.describe('group, arrange, delete, clipboard', () => {
  test('⌘G groups, ⇧⌘G ungroups; each one undo step', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'c']);
    const grouped = await oneUndoStep(page, () => page.keyboard.press('Meta+g'));
    let doc = await getDoc(page);
    const group = Object.values<any>(doc.frames).find((f) => f.type === 'group');
    expect(group.childIds).toEqual(['a', 'c']);
    expect(grouped).toEqual([group.id]);
    await setSelection(page, [group.id]);
    // clicking a child selects the group
    await clickPage(page, { x: 150, y: 140 });
    expect(await selection(page)).toEqual([group.id]);

    const ungrouped = await oneUndoStep(page, () => page.keyboard.press('Meta+Shift+g'));
    expect(ungrouped).toEqual(['a', 'c']);
    doc = await getDoc(page);
    expect(Object.values<any>(doc.frames).some((f) => f.type === 'group')).toBe(false);
  });

  test('arrange: ⌘] ⌘[ ⇧⌘] ⇧⌘[', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    const items = async () => (await getDoc(page)).pages.page_1.items;
    await setSelection(page, ['a']);
    await oneUndoStep(page, () => page.keyboard.press('Meta+]'));
    expect(await items()).toEqual(['b', 'a', 'c']);
    await page.keyboard.press('Meta+Shift+]');
    expect(await items()).toEqual(['b', 'c', 'a']);
    await page.keyboard.press('Meta+[');
    expect(await items()).toEqual(['b', 'a', 'c']);
    await page.keyboard.press('Meta+Shift+[');
    expect(await items()).toEqual(['a', 'b', 'c']);
  });

  test('Backspace and Delete remove the selection in one undo step', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a', 'b']);
    await oneUndoStep(page, () => page.keyboard.press('Backspace'));
    expect(Object.keys((await getDoc(page)).frames)).toEqual(['c']);
    expect(await selection(page)).toEqual([]);
    await page.keyboard.press('Meta+z');
    await setSelection(page, ['c']);
    await oneUndoStep(page, () => page.keyboard.press('Delete'));
    expect(Object.keys((await getDoc(page)).frames)).toEqual(['a', 'b']);
  });

  test('copy and paste within the app; cut; paste in place; duplicate', async ({ galley }) => {
    const { page } = galley;
    await setup(page);
    await setSelection(page, ['a']);
    await page.keyboard.press('Meta+c');
    expect(await undoSteps(page)).toBe(0); // copying is not a document change
    const pasted = await oneUndoStep(page, () => page.keyboard.press('Meta+v'));
    let doc = await getDoc(page);
    expect(doc.pages.page_1.items).toHaveLength(4);
    const copy = Object.values<any>(doc.frames).find((f) => f.id !== 'a' && f.x === 112 && f.y === 112);
    expect(copy).toMatchObject({ type: 'rect', w: 100, h: 80 });
    expect(pasted).toEqual([copy.id]);

    await oneUndoStep(page, () => page.keyboard.press('Meta+Alt+Shift+v')); // in place
    doc = await getDoc(page);
    expect(Object.values<any>(doc.frames).filter((f) => f.x === 100 && f.y === 100)).toHaveLength(2);

    await setSelection(page, ['b']);
    await oneUndoStep(page, () => page.keyboard.press('Meta+x'));
    expect((await getDoc(page)).frames.b).toBeUndefined();
    await page.keyboard.press('Meta+v');
    doc = await getDoc(page);
    expect(Object.values<any>(doc.frames).some((f) => f.x === 312 && f.y === 112)).toBe(true);

    await setSelection(page, ['c']);
    await oneUndoStep(page, () => page.keyboard.press('Meta+Alt+Shift+d'));
    doc = await getDoc(page);
    expect(Object.values<any>(doc.frames).some((f) => f.type === 'ellipse' && f.x === 112 && f.y === 312)).toBe(true);
  });
});

test('the selection overlay: outline, eight handles and a center mark (screenshot)', async ({ galley }, testInfo) => {
  const { page } = galley;
  await setup(page, [
    { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 120, fill: 'black' },
    { id: 'b', type: 'ellipse', x: 340, y: 120, w: 140, h: 140, rotation: 30 },
  ]);
  await setSelection(page, ['b']);
  await page.mouse.move(5, 5);
  await expect(page.locator('[data-handle]')).toHaveCount(8);
  await snap(page, 'selection', { testInfo });
  await expectBaseline(page, 'selection');
  await setSelection(page, ['a', 'b']);
  await expect(page.locator('[data-selected-id]')).toHaveCount(2);
  await snap(page, 'selection-multi', { testInfo });
});
