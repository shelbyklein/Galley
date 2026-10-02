import { test, expect } from '../helpers/fixtures';
import { getDoc } from '../canvas/helpers';
import { expectBaseline, snap } from '../helpers/screenshot';
import { field, selectRange, specimen } from './helpers';
test.use({ open: null });
test('baseline shift moves selected glyphs relative to neighboring text without changing paragraph flow', async ({ galley }) => {
  const { page } = galley;
  await specimen(page); await selectRange(page, 'story_a', 1, 9);
  const paragraph = page.locator('[data-frame-id="a"] p').first();
  const geometry = () => paragraph.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const boundary = (index: number): [Text, number] => {
      for (const node of nodes) { if (index <= node.length) return [node, index]; index -= node.length; }
      throw new Error('Text boundary outside paragraph');
    };
    const glyph = (start: number, end: number) => { const range = document.createRange(); range.setStart(...boundary(start)); range.setEnd(...boundary(end)); return range.getBoundingClientRect(); };
    const head = glyph(0, 8); const tail = glyph(9, 17);
    return { relativeTop: head.top - tail.top, height: el.getBoundingClientRect().height };
  });
  const before = await geometry();
  const zoom = await page.evaluate(() => (window as any).__galley.store.getState().viewport.zoom);
  await field(page, 'baselineShift', '3');
  const raised = await geometry();
  expect(raised.relativeTop - before.relativeTop).toBeCloseTo(-3 * zoom, 1);
  expect(raised.height).toBeCloseTo(before.height, 1);
  await field(page, 'baselineShift', '-3');
  const lowered = await geometry();
  expect(lowered.relativeTop - before.relativeTop).toBeCloseTo(3 * zoom, 1);
  expect(lowered.height).toBeCloseTo(before.height, 1);
});
test('character controls change selected text and its computed typography; one undo restores each edit', async ({ galley }) => {
  test.setTimeout(120_000);
  const { page } = galley;
  await specimen(page); await selectRange(page);
  const strip = page.getByTestId('type-control-strip');
  const run = page.locator('[data-frame-id="a"] p').first().locator('span').first();
  const marks = async () => (await getDoc(page)).stories.story_a.doc.content[0].content[0].marks?.find((m: any) => m.type === 'override')?.attrs;
  for (const [name, value, prop, css] of [
    ['fontSize', '18', 'font-size', '24px'], ['leading', '21', 'line-height', '28px'], ['tracking', '50', 'letter-spacing', '1.2px'], ['baselineShift', '3', 'top', '-4px'],
  ]) {
    await field(page, name!, value!); await expect(run).toHaveCSS(prop!, css!);
    expect((await marks())[name === 'tracking' ? 'shared' : 'print'][name!]).toBe(Number(value));
  }
  await strip.locator('[data-type-control="fontStyle"]').selectOption('700:italic');
  await expect(run).toHaveCSS('font-weight', '700'); await expect(run).toHaveCSS('font-style', 'italic');
  expect((await marks()).shared.fontWeight).toBe(700);
  await expect(strip.locator('[data-type-control="fontStyle"]')).toHaveCSS('font-family', 'Inter');
  await expect(strip.locator('[data-type-control="fontStyle"]')).toHaveCSS('font-weight', '700');
  await expect(strip.locator('[data-type-control="fontStyle"]')).toHaveCSS('font-style', 'italic');
  await strip.locator('[data-type-control="fontFamily"]').selectOption('Inter');
  await expect(run).toHaveCSS('font-family', 'Inter, sans-serif'); expect((await marks()).shared.fontFamily).toBe('Inter');
  await expect(run).toHaveCSS('font-weight', '700'); await expect(run).toHaveCSS('font-style', 'italic');
  await strip.locator('[data-type-control="kerning"]').selectOption('none');
  await expect(run).toHaveCSS('font-kerning', 'none'); expect((await marks()).shared.kerning).toBe('none');
  for (const [v, prop, css] of [['allCaps', 'text-transform', 'uppercase'], ['smallCaps', 'font-variant-caps', 'small-caps'], ['normal', 'font-variant-caps', 'normal']]) {
    await strip.locator('[data-type-control="textCase"]').selectOption(v!); await expect(run).toHaveCSS(prop!, css!); expect((await marks()).shared.textCase).toBe(v);
  }
  for (const [tag, value] of [['liga', false], ['smcp', true], ['onum', true], ['frac', true]] as const) {
    await strip.locator(`[data-type-control="${tag}"]`).setChecked(value);
    await expect.poll(() => run.evaluate((el) => getComputedStyle(el).fontFeatureSettings)).toContain(`"${tag}"${value ? '' : ' 0'}`);
    expect((await marks()).shared.features[tag]).toBe(value);
  }
  for (const tag of ['ss01', 'ss20']) {
    await strip.locator('[data-type-control="stylisticSet"]').selectOption(tag);
    await expect.poll(() => run.evaluate((el) => getComputedStyle(el).fontFeatureSettings)).toContain(`"${tag}"`); expect((await marks()).shared.features[tag]).toBe(true);
  }
  await strip.locator('[data-type-control="baselinePreset"]').selectOption('sub');
  await expect(run).toHaveCSS('top', '4.8px'); expect((await marks()).print.baselineShift).toBe(-3.6);
  await strip.locator('[data-type-control="baselinePreset"]').selectOption('super');
  await expect(run).toHaveCSS('top', '-7.92px');
  await strip.locator('[data-type-control="baselinePreset"]').selectOption('normal');
  await expect(run).toHaveCSS('position', 'static');
  await strip.locator('[data-type-control="language"]').selectOption('de'); expect((await marks()).shared.language).toBe('de');
  await expect(run).toHaveAttribute('lang', 'de');
  await strip.locator('[data-type-control="fill"]').selectOption('paper'); await expect(run).toHaveCSS('color', 'rgb(255, 255, 255)'); expect((await marks()).shared.fill.swatchId).toBe('paper');
  await strip.locator('[data-type-control="fill"]').selectOption('black');
  await strip.locator('[data-type-control="tint"]').fill('60'); await expect.poll(marks).toMatchObject({ shared: { fill: { tint: 60 } } });
  const tintColor = await run.evaluate((el) => getComputedStyle(el).color);
  await strip.locator('[data-type-control="tint"]').fill('100'); await expect.poll(() => run.evaluate((el) => getComputedStyle(el).color)).not.toBe(tintColor);
  await strip.locator('[data-type-control="overprint"]').check(); expect((await marks()).shared.fill.overprint).toBe(true);
  const before = JSON.stringify(await getDoc(page));
  await field(page, 'fontSize', '24'); await expect(run).toHaveCSS('font-size', '32px');
  await page.evaluate(() => (window as any).__galley.store.getState().undo());
  expect(JSON.stringify(await getDoc(page))).toBe(before);
  await field(page, 'fontSize', '-2'); await expect(run).toHaveCSS('font-size', '24px');
  await snap(page, 'type-character'); await expectBaseline(page, 'type-character');
});
test('paragraph controls change the touched paragraph and its computed layout, including drop caps', async ({ galley }) => {
  const { page } = galley; await specimen(page); await selectRange(page, 'story_a', 52, 80);
  const strip = page.getByTestId('type-control-strip');
  await strip.getByRole('button', { name: 'Paragraph controls', exact: true }).click();
  const p = page.locator('[data-frame-id="a"] p').nth(1);
  const attrs = async () => (await getDoc(page)).stories.story_a.doc.content[1].attrs.overrides.print;
  await strip.locator('[data-type-control="align"]').selectOption('justify');
  await expect(p).toHaveCSS('text-align', 'justify'); expect((await attrs()).align).toBe('justify');
  for (const [name, value, prop, css] of [['firstLineIndent','12','text-indent','16px'], ['leftIndent','6','padding-left','8px'], ['rightIndent','3','padding-right','4px'], ['spaceBefore','9','padding-top','12px'], ['spaceAfter','12','padding-bottom','16px']]) {
    await field(page, name!, value!); await expect(p).toHaveCSS(prop!, css!); expect((await attrs())[name!]).toBe(Number(value));
  }
  await strip.locator('[data-type-control="hyphenate"]').uncheck(); await expect(p).toHaveCSS('hyphens','manual'); expect((await attrs()).hyphenate).toBe(false);
  await strip.locator('[data-type-control="hyphenate"]').check(); await expect(p).toHaveCSS('hyphens','auto');
  for (const [name, value] of [['hyphenMinWord','7'], ['hyphenMinBefore','3'], ['hyphenMinAfter','4']]) { await field(page,name!,value!); expect((await attrs())[name!]).toBe(Number(value)); }
  await expect(p).toHaveCSS('hyphenate-limit-chars','7 3 4');
  await field(page,'hyphenMinBefore','Auto'); await expect(p).toHaveCSS('hyphenate-limit-chars','7 auto 4'); expect((await attrs()).hyphenMinBefore).toBeNull();
  const firstLetterWidth = () => p.evaluate((el) => { const node = el.querySelector('span')!.firstChild!; const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 1); return r.getBoundingClientRect().width; });
  const beforeDrop = await firstLetterWidth();
  await field(page,'dropCapLines','3'); expect((await attrs()).dropCapLines).toBe(3);
  await expect.poll(() => p.evaluate((el) => getComputedStyle(el,'::first-letter').getPropertyValue('initial-letter'))).toBe('3');
  await expect.poll(firstLetterWidth).toBeGreaterThan(beforeDrop * 2);
  await snap(page,'type-paragraph'); await expectBaseline(page,'type-paragraph');
  const text = await p.textContent();
  await field(page,'dropCapChars','3'); expect((await attrs()).dropCapChars).toBe(3);
  const cap = p.locator('[data-drop-cap="3"]');
  await expect(cap).toHaveText('Par'); await expect(cap).toHaveCSS('float','left'); await expect(cap).toHaveCSS('font-size','56px'); await expect(cap).toHaveCSS('height','60px');
  expect(await p.textContent()).toBe(text);
  await snap(page,'type-drop-cap-multiple'); await expectBaseline(page,'type-drop-cap-multiple');
  await field(page,'dropCapLines','0'); await expect(p.locator('[data-drop-cap]')).toHaveCount(0);
  await expect(strip.getByRole('textbox',{name:'Hyphen lines',exact:true})).toBeDisabled();
});
