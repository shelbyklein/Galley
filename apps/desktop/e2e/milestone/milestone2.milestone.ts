import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '../helpers/fixtures';
import { REPO_ROOT } from '../helpers/launch';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { clickPage, flushInput, getDoc } from '../canvas/helpers';
import { clickMenuItem, getShellState, stubDialogs } from '../shell/helpers';
import { chooseTool, clearStroke, drawWith, makeSwatch, paintFill, setGeometry, storyText, typeInto, TOOL_ENV } from './helpers';
import { captureFlyerLines, checkFlyer, flyerShot, FLYER_SHOTS } from './flyer-proof';

// A complete document is authored through the visible UI; only native file dialogs are stubbed. Font setup installs
// known OFL source files into an otherwise blank package. Assertions read state; they never write the document model.
test.use({ open: null });
let work = '';
test.afterEach(async ({}, info) => {
  if (work && info.status === info.expectedStatus) fs.rmSync(work, { recursive: true, force: true });
  else if (work) console.log(`Flyer acceptance evidence retained: ${work}`);
});

const COPY = [
  'Every print in the show starts as a stack of separations. The studio mixes its own inks, so the orange on the poster is the same orange on the shop door. Registration is checked by eye and by loupe before the first pull. The printers test each layer on scrap paper and keep the approved sheet beside the press. Small shifts become part of the character of the finished edition.',
  'Visitors can try a two color pull at the letterpress, ink a block, and take home the sheet. Screens are reclaimed between demos, and the riso runs a short edition of postcards that change every hour of the day. Bring a tote; the paper goes fast. Prints are signed and numbered, and the proceeds fund the next show. Ask the volunteers about the inks and the papers. They are happy to show the difference a texture can make.',
  'The studios are wheelchair accessible and the courtyard has shade, water and seating. Guided tours leave the front desk on the hour, starting at ten. Each tour visits four studios and ends at the drying racks, where the morning prints are hung to cure before they go on sale in the afternoon. Food trucks park on Grove Street from eleven until the last print sells, and the coffee cart opens at nine for early visitors.',
  'Workshop sign ups open on the studio website the week before. Spaces are limited to eight people per session so everyone gets time on the press. Aprons, gloves and paper are provided, and every participant leaves with a finished print and a sheet of notes on the process. Children under twelve are welcome with an adult. Wear clothes that can take a little ink and leave room in your bag for a sheet of paper.',
  'The studios close for cleanup at four, and the courtyard stays open until the light goes. Thank you to the printers, volunteers and neighbours who make this day possible. Follow the studio newsletter for the next edition and photographs from the workshops. The doors are open, the presses are ready, and there is always another layer to discover. Free entry, all ages, no experience required.',
].join('\n');

test('builds a styled flyer with two linked frames and contour wrap, saves/reopens it, and exports matching real fonts and pure black text', async ({ galley }, info) => {
  const { page, app } = galley;
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-milestone2-'));
  let pkg = path.join(work, 'Process Notes.galley');
  const pdf = path.join(work, 'Process Notes.pdf');
  fs.rmSync(FLYER_SHOTS, { recursive: true, force: true });
  await page.keyboard.press('Meta+n');
  const dialog = page.getByTestId('new-document-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-field="preset"]').selectOption('letter');
  for (const [field, value] of [['bleed-top', '0.125'], ['slug-top', '0.5'], ['columns', '2']]) {
    await dialog.locator(`[data-field="${field}"]`).fill(value!); await page.keyboard.press('Tab');
  }
  await dialog.getByTestId('dialog-ok').click();
  await stubDialogs(app, { save: [pkg] });
  await clickMenuItem(app, 'file.saveAs');
  await expect.poll(async () => (await getShellState(page)).packagePath).toBe(pkg);
  const fontSetup = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), [path.join(REPO_ROOT, 'scripts/milestone2/prepare-fonts.ts'), pkg], { encoding: 'utf8', env: TOOL_ENV });
  expect(fontSetup.status, fontSetup.stderr).toBe(0);
  await stubDialogs(app, { open: [pkg], save: [pdf] });
  await clickMenuItem(app, 'file.open');
  await page.keyboard.press('Meta+0');
  await flushInput(page);

  await makeSwatch(page, { name: 'Studio Orange', kind: 'cmyk', values: [0, 60, 100, 0] });
  const title = await drawWith(page, 'type', { x: 36, y: 45 }, { x: 576, y: 110 });
  await typeInto(page, title.id, 'PROCESS NOTES');
  await chooseTool(page, 'type');
  const typeStrip = page.getByTestId('type-control-strip');
  await typeStrip.locator('[data-type-control="fontFamily"]').selectOption('Roboto');
  await typeStrip.locator('[data-type-control="fontStyle"]').selectOption('700:normal');
  for (const [field, value] of [['fontSize', '30'], ['leading', '36']]) {
    const input = typeStrip.locator(`[data-field="${field}"]`); await input.fill(value!); await input.press('Enter');
  }
  await flyerShot(page, '01-variable-heading');

  const left = await drawWith(page, 'type', { x: 36, y: 160 }, { x: 300, y: 628 });
  await typeInto(page, left.id, COPY);
  const right = await drawWith(page, 'type', { x: 312, y: 160 }, { x: 576, y: 628 });
  await page.keyboard.press('Escape');
  await chooseTool(page, 'select');
  await clickPage(page, { x: 70, y: 170 });
  await page.locator(`[data-text-port="out"][data-frame-id="${left.id}"]`).click();
  await page.locator(`[data-text-port="in"][data-frame-id="${right.id}"]`).click();
  await expect.poll(async () => {
    const doc = await getDoc(page); return doc.stories[doc.frames[left.id].storyId].frameIds;
  }).toEqual([left.id, right.id]);
  await clickPage(page, { x: 70, y: 170 });
  await chooseTool(page, 'type');

  // Edit the whole story from its selected frame, then capture those properties in a named paragraph style.
  await typeStrip.locator('[data-type-control="fontFamily"]').selectOption('Inter');
  await typeStrip.locator('[data-type-control="fontStyle"]').selectOption('400:normal');
  for (const [field, value] of [['fontSize', '10'], ['leading', '13.5']]) {
    const input = typeStrip.locator(`[data-field="${field}"]`); await input.fill(value!); await input.press('Enter');
  }
  await page.getByRole('button', { name: 'Paragraph controls', exact: true }).click();
  const hyphenate = typeStrip.locator('[data-type-control="hyphenate"]');
  await hyphenate.uncheck();
  await clickMenuItem(app, 'window.paragraphStyles');
  const styles = page.locator('[data-panel="paragraphStyles"]');
  await styles.getByRole('button', { name: 'New paragraph style', exact: true }).click();
  const editor = page.getByTestId('paragraph-style-editor');
  await editor.getByLabel('Style name', { exact: true }).fill('Body');
  await editor.getByRole('tab', { name: 'Print', exact: true }).click();
  for (const [field, value] of [['fontSize', '10'], ['leading', '13.5']]) {
    const input = editor.locator(`[data-field="${field}"]`); await input.fill(value!); await input.press('Enter');
  }
  await editor.locator('[data-type-control="hyphenate"]').uncheck();
  await editor.getByRole('button', { name: 'Save Style', exact: true }).click();
  await styles.getByRole('option', { name: /^Body$/ }).click();
  const bodyDoc = await getDoc(page);
  const bodyId = Object.values<any>(bodyDoc.paragraphStyles).find(s => s.name === 'Body')!.id;
  expect(bodyDoc.stories[bodyDoc.frames[left.id].storyId].doc.content.every((p: any) => p.attrs.style === bodyId)).toBe(true);
  expect(storyText(bodyDoc, bodyDoc.frames[left.id].storyId).trim()).toBe(COPY);
  await flyerShot(page, '02-threaded-body-style');

  const badge = await drawWith(page, 'ellipse', { x: 478, y: 265 }, { x: 576, y: 363 });
  await setGeometry(page, { x: 478, y: 265, w: 98, h: 98 });
  await paintFill(page, 'Studio Orange'); await clearStroke(page);
  await clickMenuItem(app, 'window.textWrap');
  await page.getByTestId('wrap-mode').selectOption('contour');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const offset = page.getByTestId(`wrap-offset-${side}`); await offset.fill('9'); await offset.press('Enter');
  }
  await expect.poll(async () => (await getDoc(page)).frames[badge.id].textWrap.mode).toBe('contour');
  await chooseTool(page, 'select');
  await clickPage(page, { x: 70, y: 170 });
  await clickMenuItem(app, 'view.showTextThreads');
  await flyerShot(page, '03-type-mode-wrap');
  await page.keyboard.press('Meta+Shift+a');

  const doc = await getDoc(page);
  expect(doc.stories[doc.frames[left.id].storyId].frameIds).toEqual([left.id, right.id]);
  // Save As must preserve the exact document-font source files as well as the text and frames.
  const originalPackage = pkg;
  pkg = path.join(work, 'Process Notes Copy.galley');
  await stubDialogs(app, { save: [pkg] });
  await clickMenuItem(app, 'file.saveAs');
  await expect.poll(async () => (await getShellState(page)).packagePath).toBe(pkg);
  for (const name of ['Inter-Regular.ttf', 'Roboto-Variable.ttf']) {
    expect(fs.readFileSync(path.join(pkg, 'fonts', name))).toEqual(fs.readFileSync(path.join(originalPackage, 'fonts', name)));
  }
  await flushInput(page);
  const headingRequest = await page.evaluate(id => {
    const g = (window as any).__galley, d = g.store.getState().history.doc;
    const p = d.stories[d.frames[id].storyId].doc.content[0];
    const r = g.model.resolveParagraph(d, g.model.paragraphAttrs(p));
    return { family: r.fontFamily, weight: r.fontWeight, style: r.fontStyle };
  }, title.id);
  expect(headingRequest).toEqual({ family: 'Roboto', weight: 700, style: 'normal' });
  const headingFont = await page.evaluate(request => (window as any).galley.fonts.resolve([request]), headingRequest);
  expect(headingFont[0]).toMatchObject({ family: 'Roboto', weight: 700, style: 'normal', face: { source: 'document', format: 'variable' }, instanceAxes: { wght: 700 } });
  await expect(page.locator(`.galley-text[data-frame-id="${title.id}"] p`).first()).toHaveCSS('font-weight', '700');
  expect(await page.evaluate(() => document.fonts.check('normal 700 30pt "Roboto"'))).toBe(true);
  const painted = await captureFlyerLines(page, [title.id, left.id, right.id]);
  expect(painted[0]!.lines.map(l => l.text)).toEqual(['PROCESS NOTES']);
  expect(painted.slice(1).every(f => f.lines.length > 8)).toBe(true);
  expect(painted[2]!.lines.some(l => l.cy > 250 && l.cy < 380 && l.right < 470)).toBe(true);
  const proof = { frames: painted, blackFrameId: left.id, staticFamily: 'Inter', variableFamily: 'Roboto' };
  const screenFile = path.join(work, 'screen.json'); fs.writeFileSync(screenFile, JSON.stringify(proof));
  await flyerShot(page, '04-finished-flyer');
  await clickMenuItem(app, 'file.save');
  await expect.poll(async () => (await getEditorState(page)).dirty).toBe(false);
  const saved = await getDocumentJson(page);
  await stubDialogs(app, { open: [pkg], save: [pdf] });
  await clickMenuItem(app, 'file.open');
  await expect.poll(async () => await getDocumentJson(page)).toBe(saved);
  await page.keyboard.press('Meta+0'); await flushInput(page);
  expect(await captureFlyerLines(page, [title.id, left.id, right.id])).toEqual(painted);
  await flyerShot(page, '05-reopened');

  await page.keyboard.press('Meta+e');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await flyerShot(page, '06-export-dialog');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('export-path')).toHaveText(pdf);
  await page.getByTestId('export-done').click();
  const result = checkFlyer(pdf, pkg, screenFile, path.join(work, 'checks'));
  await info.attach('flyer-proof.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  fs.writeFileSync(path.join(FLYER_SHOTS, 'proof.json'), JSON.stringify(result, null, 2));
  const rendered = spawnSync('pdftoppm', ['-png', '-r', '90', '-singlefile', pdf, path.join(FLYER_SHOTS, '07-exported-pdf')], { encoding: 'utf8', env: TOOL_ENV });
  expect(rendered.status, rendered.stderr).toBe(0);
  console.log(`Flyer: ${result.lineMatch.lines} lines, ${result.lineMatch.mismatches} mismatches; ${result.checks.length} PDF/font/ink checks passed.`);
});
