import { FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getDocument, getEditorState } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';

// P1-03: the editor opens fixtures/poster-basic.galley and draws it with the shared page renderer.
test.use({ open: FIXTURES.posterBasic });

test('the editor opens the poster fixture and renders it', async ({ galley }, testInfo) => {
  const { page } = galley;
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));

  // the model: opened from disk, not edited
  const doc = await getDocument(page);
  expect(doc.meta.title).toBe('Spring Poster');
  expect(Object.keys(doc.frames)).toHaveLength(9);
  expect((await getEditorState(page)).dirty).toBe(false);
  await expect(page.getByTestId('doc-title')).toHaveText('Spring Poster');

  // the render: one page, screen mode, paper on the trim box, every frame drawn, fonts and image loaded
  await page.waitForSelector('.galley-page[data-ready="true"]');
  const sheet = page.locator('.galley-page');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toHaveAttribute('data-color-mode', 'screen');
  await expect(page.locator('.galley-paper')).toHaveCount(1);
  expect(await page.locator('.galley-page [data-frame-id]').count()).toBe(9);
  expect(await page.locator('.galley-text').allTextContents()).toEqual([
    'SPRING',
    'OPEN STUDIO',
    'Saturday, May 16 · 10am–4pm · 412 Grove Street',
    'Twenty studios open their doors for one day. Watch screen printing, letterpress and riso demos, browse prints, and meet the people who make them. Free entry, all ages.',
    'galleystudio.example/spring',
    'FREE',
  ]);
  const image = await page.locator('.galley-image img').evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight, ok: img.complete }));
  expect(image).toEqual({ w: 2400, h: 1280, ok: true });
  const fonts = await page.evaluate(() => ['400 16px Inter', '700 16px Inter', '800 16px Inter', '900 16px Inter'].map((f) => document.fonts.check(f)));
  expect(fonts).toEqual([true, true, true, true]);

  // the poster text really is set in Inter, not a fallback: the headline is 800 weight at 160pt (its paragraph style carries it)
  const headline = await page.locator('[data-frame-id="spring"] p').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize };
  });
  expect(headline.weight).toBe('800');
  expect(parseFloat(headline.size)).toBeCloseTo(160 * (4 / 3), 2); // 160 pt in CSS px
  expect(headline.family).toContain('Inter');

  await snap(page, 'poster-basic', { testInfo });
  await expectBaseline(page, 'poster-basic');
  expect(problems).toEqual([]);
});

test('with no document the editor shows a blank Letter page', async ({ galley }) => {
  // (this file's default is the poster; launch the other variant through the app hook instead)
  const { page } = galley;
  await page.evaluate(() => {
    const g = (window as unknown as { __galley: { store: { getState(): any }; model: any } }).__galley;
    g.store.getState().openDocument(g.model.createDocument({ engineVersion: 'test' }));
  });
  await page.waitForSelector('.galley-page[data-ready="true"]');
  await expect(page.locator('.galley-page')).toHaveCount(1);
  await expect(page.locator('.galley-page [data-frame-id]')).toHaveCount(0);
  await expect(page.getByTestId('doc-title')).toHaveText('Untitled');
  const size = await page.locator('.galley-page').evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height }));
  expect(size).toEqual({ w: '612pt', h: '792pt' });
});
