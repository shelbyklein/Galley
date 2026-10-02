import { test, expect } from '../helpers/fixtures';
import { clickPage, getDoc } from '../canvas/helpers';
import { chooseTool } from '../milestone/helpers';
import { waitForStable, snap } from '../helpers/screenshot';
import type { FontBridge } from '@galley/fonts/types';
import fs from 'node:fs';

// P2-06 integration: use the visible font menus, then independently verify the exact installed bytes they chose.
test('the Type font menus list installed families and load the selected real style from its exact file', async ({ galley }, info) => {
  const { page } = galley;
  await waitForStable(page);
  const families = await page.evaluate(() => (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts.families());
  const family = families.find(f => f.source === 'system' && f.faces.some(face => face.source === 'system' && face.style === 'normal' && face.format === 'truetype' && /\.ttf$/i.test(face.path)));
  test.skip(!family, 'No installed static TrueType family is available on this machine.');
  const face = family!.faces.find(f => f.source === 'system' && f.style === 'normal' && f.format === 'truetype' && /\.ttf$/i.test(f.path))!;
  const doc = await getDoc(page);
  const frame = Object.values<any>(doc.frames).find(f => f.type === 'text' && f.rotation === 0)!;
  await clickPage(page, { x: frame.x + 5, y: frame.y + 5 });
  await chooseTool(page, 'type');
  const strip = page.getByTestId('type-control-strip');
  const familyMenu = strip.locator('[data-type-control="fontFamily"]');
  await expect(familyMenu.locator('option')).toContainText(families.map(f => f.family));
  await familyMenu.selectOption(family!.family);
  await strip.locator('[data-type-control="fontStyle"]').selectOption(`${face.weight}:${face.style}`);
  await waitForStable(page);
  const actual = await page.evaluate(async ({ frameId, request }) => {
    const g = (window as any).__galley, d = g.store.getState().history.doc;
    const p = d.stories[d.frames[frameId].storyId].doc.content[0];
    const paragraph = g.model.resolveParagraph(d, g.model.paragraphAttrs(p));
    const r = g.model.resolveRun(d, paragraph, p.content?.[0]?.marks);
    const bridge = (window as unknown as { galley: { fonts: FontBridge } }).galley.fonts;
    const bindings = await bridge.resolve([request]);
    const loaded = await document.fonts.load(`${request.style} ${request.weight} 16px ${JSON.stringify(request.family)}`);
    return { requested: { family: r.fontFamily, weight: r.fontWeight, style: r.fontStyle }, binding: bindings[0],
      count: loaded.length, loaded: loaded.every(f => f.status === 'loaded'), bytes: [...new Uint8Array(await (await fetch(bindings[0]!.url)).arrayBuffer())] };
  }, { frameId: frame.id, request: { family: family!.family, weight: face.weight, style: face.style } });
  expect(actual.requested).toEqual({ family: family!.family, weight: face.weight, style: face.style });
  expect(actual).toMatchObject({ count: 1, loaded: true, binding: { face: { path: face.path, source: 'system' } } });
  expect(Buffer.from(actual.bytes)).toEqual(fs.readFileSync(face.path));
  await expect.poll(() => strip.locator('[data-type-control="fontStyle"]').evaluate(el => getComputedStyle(el).fontFamily.replace(/^["']|["']$/g, ''))).toBe(family!.family);
  await expect(strip.locator('[data-type-control="fontStyle"]')).toHaveCSS('font-weight', String(face.weight));
  await snap(page, 'integrated-system-font-menu', { testInfo: info });
});
