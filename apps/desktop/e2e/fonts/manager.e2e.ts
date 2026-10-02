import fs from 'node:fs';
import { test, expect } from '../helpers/fixtures';
import { snap, expectBaseline, waitForStable } from '../helpers/screenshot';
import type { FontBridge, FontFamilyInfo } from '@galley/fonts/types';

test('inventory lists installed families and choosing one loads the exact registered file', async ({ galley }, testInfo) => {
  const { page } = galley;
  const families = await page.evaluate(() => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.families());
  const family = families.find((f: FontFamilyInfo) => f.source === 'system' && f.faces.some((face) => face.style === 'normal' && face.format === 'truetype' && /\.ttf$/i.test(face.path)));
  test.skip(!family, 'No static TrueType system font found at runtime; no system fonts are bundled in the test.');
  const face = family!.faces.find((f) => f.style === 'normal' && f.format === 'truetype' && /\.ttf$/i.test(f.path))!;
  const request = { family: family!.family, weight: face.weight, style: face.style };
  await page.evaluate((r) => {
    const g = (window as unknown as { __galley: any }).__galley; const s = g.store.getState();
    const style = Object.values(s.history.doc.paragraphStyles).find((p: any) => p.shared.fontFamily === 'Inter') as any;
    s.dispatch(g.model.setStyle, { kind: 'paragraph', style: { ...style, shared: { ...style.shared, fontFamily: r.family, fontWeight: r.weight, fontStyle: r.style } } });
  }, request);
  await waitForStable(page);
  const result = await page.evaluate(async (r) => {
    const matches = await document.fonts.load(`${r.style} ${r.weight} 16px "${r.family}"`);
    return { count: matches.length, loaded: matches.every((f) => f.status === 'loaded') };
  }, request);
  expect(result).toMatchObject({ count: 1, loaded: true });
  const binding = await page.evaluate((r) => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.resolve([r]), request);
  expect(binding[0]!.face.path).toBe(face.path);
  expect(binding[0]!.face.source).toBe('system');
  const bytes = await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], binding[0]!.url);
  expect(Buffer.from(bytes)).toEqual(fs.readFileSync(face.path));
  await snap(page, 'system-font-file', { testInfo });
});

test('missing paragraph fonts are highlighted and listed with Inter substitution', async ({ galley }, testInfo) => {
  const { page } = galley;
  await page.evaluate(() => {
    const g = (window as unknown as { __galley: any }).__galley; const s = g.store.getState();
    const doc = s.history.doc;
    const style = Object.values(doc.paragraphStyles).find((p: any) => p.shared.fontFamily === 'Inter') as any;
    s.dispatch(g.model.setStyle, { kind: 'paragraph', style: { ...style, shared: { ...style.shared, fontFamily: 'Galley Missing Fixture' } } });
  });
  await waitForStable(page);
  await expect(page.locator('[data-missing-font="Galley Missing Fixture"]').first()).toBeVisible();
  await expect(page.locator('[data-missing-font="Galley Missing Fixture"]').first()).toHaveCSS('background-color', 'rgb(255, 213, 231)');
  await page.getByTestId('status-missing-fonts').locator('summary').click();
  await expect(page.getByTestId('status-missing-fonts')).toContainText('Galley Missing Fixture');
  await expect(page.getByTestId('status-missing-fonts')).toContainText('substituted with Inter');
  await snap(page, 'missing-font-highlight', { testInfo });
  await expectBaseline(page, 'missing-font-highlight');
});
