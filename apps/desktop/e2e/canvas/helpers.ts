import type { Page } from '@playwright/test';
import { getEditorState } from '../helpers/app-state';
import { waitForStable } from '../helpers/screenshot';

/**
 * Helpers for the canvas specs (lane B). They talk to the app through `window.__galley` (store, commands, model) and drive
 * the pointer in *page points*, converting through the viewport the app reports, so a test says "drag from (100, 200) to
 * (300, 200)" whatever the zoom.
 */

interface Hook {
  store: { getState(): any };
  commands: { execute(id: string): Promise<boolean> };
  model: any;
}

export interface Pt {
  x: number;
  y: number;
}

/** The pasteboard element's box in window pixels (the origin the viewport's pan is measured from). */
export async function viewportBox(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (!box) throw new Error('the canvas viewport is not visible');
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}

/** Window pixel position of a point on the current page (points from the trim box's top-left). */
export async function pageToScreen(page: Page, p: Pt): Promise<Pt> {
  const [{ viewport }, box] = await Promise.all([getEditorState(page), viewportBox(page)]);
  return { x: box.left + viewport.panX + p.x * viewport.zoom, y: box.top + viewport.panY + p.y * viewport.zoom };
}

/** Page point under a window pixel. */
export async function screenToPage(page: Page, p: Pt): Promise<Pt> {
  const [{ viewport }, box] = await Promise.all([getEditorState(page), viewportBox(page)]);
  return { x: (p.x - box.left - viewport.panX) / viewport.zoom, y: (p.y - box.top - viewport.panY) / viewport.zoom };
}

/**
 * Wait until the page has processed the input events already sent. Chromium dispatches pointer moves once per frame, and a
 * CDP mouse call can return before the page has handled it, so a test that reads state right after `mouse.up()` can see a
 * drag that is only partly applied. Two animation frames flush everything queued before them.
 */
export async function flushInput(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export interface DragOptions {
  steps?: number;
  /** Modifier keys held for the whole drag. */
  modifiers?: ('Shift' | 'Alt' | 'Meta' | 'Control')[];
  /** Stay mid-drag: do not release the button. The caller must call `page.mouse.up()`. */
  hold?: boolean;
}

/** Press at a page point, move to another in a few steps, release. */
export async function dragPage(page: Page, from: Pt, to: Pt, options: DragOptions = {}): Promise<void> {
  const a = await pageToScreen(page, from);
  const b = await pageToScreen(page, to);
  await dragScreen(page, a, b, options);
}

export async function dragScreen(page: Page, a: Pt, b: Pt, { steps = 8, modifiers = [], hold = false }: DragOptions = {}): Promise<void> {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  if (!hold) await page.mouse.up();
  if (!hold) for (const key of modifiers.reverse()) await page.keyboard.up(key);
  await flushInput(page);
}

/** Click a page point. */
export async function clickPage(page: Page, p: Pt, modifiers: ('Shift' | 'Alt' | 'Meta')[] = []): Promise<void> {
  const s = await pageToScreen(page, p);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(s.x, s.y);
  for (const key of modifiers.reverse()) await page.keyboard.up(key);
  await flushInput(page);
}

export async function setTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((t) => (window as unknown as { __galley: Hook }).__galley.store.getState().setActiveTool(t), tool);
}

export type FrameSpec = {
  id: string;
  type: 'rect' | 'ellipse' | 'line' | 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h?: number;
  rotation?: number;
  fill?: string | null;
  stroke?: { swatch: string; weight: number } | null;
  text?: string;
};

export interface DocSpec {
  page?: { width?: number; height?: number; margins?: number; columns?: { count: number; gutter: number }; bleed?: number; slug?: number };
  frames?: FrameSpec[];
  /** Ruler guides: [orientation, position]. */
  guides?: ['horizontal' | 'vertical', number][];
}

/**
 * Replace the open document with one built from a spec (blank Letter by default), as a fresh document with no undo
 * history, and wait until the page has rendered. Fills default to [Black].
 */
export async function loadDoc(page: Page, spec: DocSpec = {}): Promise<void> {
  await page.evaluate((s) => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const m = g.model;
    const doc0 = m.createDocument({ engineVersion: 'test', page: { id: 'page_1', ...s.page }, layer: { id: 'layer_1' } });
    let h = m.createHistory(doc0);
    for (const f of s.frames ?? []) {
      const base = { id: f.id, name: '', layerId: 'layer_1', x: f.x, y: f.y, w: f.w, h: f.type === 'line' ? 0 : (f.h ?? f.w), rotation: f.rotation ?? 0 };
      const fill = f.fill === undefined ? m.paint('black') : f.fill === null ? null : m.paint(f.fill);
      const stroke = f.stroke ? { paint: m.paint(f.stroke.swatch), weight: f.stroke.weight } : null;
      let frame: any;
      let story: any;
      if (f.type === 'text') {
        frame = { ...base, type: 'text', fill: null, stroke, storyId: `story_${f.id}`, inset: 0 };
        story = m.createStory(`story_${f.id}`, f.text ?? '');
      } else if (f.type === 'image') {
        frame = { ...base, type: 'image', fill: null, stroke, assetId: null, content: null };
      } else {
        frame = { ...base, type: f.type, fill: f.type === 'line' ? null : fill, stroke: f.type === 'line' && !stroke ? { paint: m.paint('black'), weight: 1 } : stroke };
      }
      h = m.applyCommand(h, m.addFrame, { frame, pageId: 'page_1', story });
    }
    for (const [i, [orientation, position]] of (s.guides ?? []).entries()) {
      h = m.applyCommand(h, m.addGuide, { guide: { id: `guide_${i + 1}`, orientation, position, pageId: 'page_1' } });
    }
    g.store.getState().openDocument(h.doc);
  }, spec);
  await page.waitForSelector('.galley-page[data-ready="true"]');
  await waitForStable(page);
}

/** The frame as stored (null when it does not exist). */
export async function getFrame(page: Page, id: string): Promise<any | null> {
  return page.evaluate((frameId) => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    return g.store.getState().history.doc.frames[frameId] ?? null;
  }, id);
}

/** The whole current document (plain object). */
export async function getDoc(page: Page): Promise<any> {
  return page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    return JSON.parse(JSON.stringify(g.store.getState().history.doc));
  });
}

export async function setSelection(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((list) => (window as unknown as { __galley: Hook }).__galley.store.getState().setSelection(list), ids);
}

export async function getView(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const s = g.store.getState();
    return { view: s.view as { rulersVisible: boolean; guidesVisible: boolean; units: string }, viewport: s.viewport as { zoom: number; panX: number; panY: number; fit: boolean } };
  });
}

/** Wait until the canvas has applied the view (fit zoom written back to the store). */
export async function settle(page: Page): Promise<void> {
  await waitForStable(page);
}
