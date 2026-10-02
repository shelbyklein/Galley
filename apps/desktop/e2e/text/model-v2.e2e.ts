import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { clickPage, getDoc, loadDoc, setTool } from '../canvas/helpers';

// P2-01: the text model in the real app. Paragraph styles, character styles and local overrides survive the Phase 1 editor,
// a thread of frames and a text wrap are stored and validated through the real command pipeline, and undo and redo restore
// them byte for byte.

test.use({ open: null });

interface Hook {
  store: { getState(): any };
  model: any;
}

/** A text frame whose story has two styled paragraphs: Body (centered by a local override, with a Strong run) and Heading. */
async function styledStory(page: Page): Promise<void> {
  await loadDoc(page, { frames: [{ id: 't', type: 'text', x: 100, y: 100, w: 300, h: 80, text: '' }] });
  await page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const m = g.model;
    const s = g.store.getState();
    s.dispatch(m.addStyle, { kind: 'paragraph', style: { id: 'body', name: 'Body', basedOn: 'basic-paragraph', shared: {}, print: { fontSize: 10, leading: 13.5 }, web: {} } });
    s.dispatch(m.addStyle, { kind: 'paragraph', style: { id: 'heading', name: 'Heading', basedOn: 'basic-paragraph', shared: { fontWeight: 800 }, print: { fontSize: 20, leading: 24 }, web: {} } });
    s.dispatch(m.addStyle, { kind: 'character', style: { id: 'strong', name: 'Strong', basedOn: null, shared: { fontWeight: 700 }, print: {}, web: {} } });
    s.dispatch(m.setStoryDoc, {
      storyId: 'story_t',
      doc: {
        type: 'doc',
        content: [
          m.styledParagraph({ style: 'body', overrides: { print: { align: 'center' } } }, 'Hello ', m.textNode('world', [m.charStyleMark('strong')])),
          m.styledParagraph({ style: 'heading' }, 'Second'),
        ],
      },
    });
  });
  await page.keyboard.press('Meta+1');
}

test('typing in a styled story keeps every paragraph style, local override and character style', async ({ galley }) => {
  const { page } = galley;
  await styledStory(page);
  await expect(page.locator('.galley-page [data-frame-id="t"] p')).toHaveCount(2);
  await setTool(page, 'type');
  await clickPage(page, { x: 250, y: 170 }); // empty space in the frame: the caret goes to the end
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third');

  const doc = (await getDoc(page)).stories.story_t.doc;
  expect(doc.content.map((p: any) => (p.content ?? []).map((r: any) => r.text).join(''))).toEqual(['Hello world', 'Second!', 'Third']);
  // the first paragraph is untouched: style, override and its character-style run
  expect(doc.content[0]).toEqual({
    type: 'paragraph',
    attrs: { style: 'body', overrides: { print: { align: 'center' } } },
    content: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', marks: [{ type: 'charStyle', attrs: { style: 'strong' } }] },
    ],
  });
  // the typed text stayed in the Heading paragraph, and the paragraph made with Enter is a Heading too
  expect(doc.content[1].attrs).toEqual({ style: 'heading' });
  expect(doc.content[2].attrs).toEqual({ style: 'heading' });
  // and the page draws them in their styles
  const styles = await page.locator('.galley-page [data-frame-id="t"] p').evaluateAll((els) => els.map((el) => ({ style: el.getAttribute('data-paragraph-style'), size: Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100, align: getComputedStyle(el).textAlign })));
  expect(styles).toEqual([
    { style: 'body', size: 13.33, align: 'center' },
    { style: 'heading', size: 26.67, align: 'left' },
    { style: 'heading', size: 26.67, align: 'left' },
  ]);
  const weight = await page.locator('.galley-page [data-frame-id="t"] p:first-child span:last-child').evaluate((el) => getComputedStyle(el).fontWeight);
  expect(weight).toBe('700');
});

test('threads, text wrap and the baseline grid go through the command pipeline and undo byte for byte', async ({ galley }) => {
  const { page } = galley;
  await loadDoc(page, {
    frames: [
      { id: 'a', type: 'text', x: 36, y: 36, w: 200, h: 100, text: 'One\nTwo' },
      { id: 'b', type: 'text', x: 36, y: 200, w: 200, h: 100, text: '' },
      { id: 'c', type: 'ellipse', x: 300, y: 36, w: 120, h: 120 },
    ],
  });
  const before = await getDocumentJson(page);

  await page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const s = g.store.getState();
    s.dispatch(g.model.linkFrames, { fromId: 'a', toId: 'b' });
    s.dispatch(g.model.setFrameProps, { ids: ['c'], props: { textWrap: { mode: 'contour', offset: 12 } } });
    s.dispatch(g.model.setBaselineGrid, { start: 36, increment: 13.5 });
  });
  const doc = await getDoc(page);
  expect(doc.stories.story_a.frameIds).toEqual(['a', 'b']);
  expect(doc.stories.story_b).toBeUndefined();
  expect(doc.frames.b.storyId).toBe('story_a');
  expect(doc.frames.c.textWrap).toEqual({ mode: 'contour', offset: 12 });
  expect(doc.baselineGrid).toEqual({ start: 36, increment: 13.5 });
  expect(await page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    return g.model.validateDocument(g.store.getState().history.doc);
  })).toEqual([]);
  // until the thread engine, the first frame of a thread shows the story and the next one is empty
  await expect(page.locator('[data-frame-id="a"] p')).toHaveCount(2);
  await expect(page.locator('[data-frame-id="b"] p')).toHaveCount(0);

  for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z');
  expect(await getDocumentJson(page)).toBe(before);
  expect((await getEditorState(page)).undoSteps).toBe(0);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Shift+z');
  expect((await getDoc(page)).stories.story_a.frameIds).toEqual(['a', 'b']);
});

test('a document serializes as formatVersion 2 and parses back to itself', async ({ galley }) => {
  const { page } = galley;
  await loadDoc(page, { frames: [{ id: 't', type: 'text', x: 100, y: 100, w: 300, h: 80, text: 'Hello' }] });
  const files = await page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const m = g.model;
    const out = m.serializeDocument(g.store.getState().history.doc);
    const again = m.serializeDocument(m.parseDocument(out));
    return { out, again };
  });
  expect(JSON.parse(files.out.document).formatVersion).toBe(2);
  expect(JSON.parse(files.out.links).formatVersion).toBe(2);
  expect(files.again).toEqual(files.out);
});
