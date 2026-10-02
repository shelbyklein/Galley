import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clickPage, flushInput, getDoc } from '../canvas/helpers';
import { getDocumentJson, getEditorState } from '../helpers/app-state';
import { test, expect } from '../helpers/fixtures';
import { launchApp, type GalleyApp } from '../helpers/launch';
import { clickMenuItem, diffPngs, getModelDoc, getShellState, stubDialogs } from '../shell/helpers';
import {
  chooseTool,
  clearStroke,
  drawWith,
  generatePhoto,
  makeSwatch,
  measurePoster,
  near,
  paintFill,
  pdfBox,
  qpdfCheck,
  renderPdf,
  requireTools,
  resetShots,
  selectedFrameId,
  setGeometry,
  settledPageShot,
  shot,
  shotWhileDragging,
  SHOTS_DIR,
  storyText,
  typeInto,
} from './helpers';

// P1-15, Milestone 1 (success criterion 1): build the Phase 1 mockup poster through the real UI, the way a person would, as far
// as Phase 1 allows; save it, close it, reopen it, and export a PDF/X-4 that passes the golden separation checks.
//
//   npm run test:milestone1     (builds the app, then runs this file; screenshots go to apps/desktop/test-results/milestone1/)
//
// Phase 1 has no text styling (that is Phase 2): every text frame uses the default style, so the headline is 12 pt black rather
// than the mockup's 160 pt Studio Blue. Studio Blue is therefore used on a flat bar, where the golden checks can measure it.
test.use({ open: null });

/** The folder this run works in (the generated photo, the package, the PDF). A passing run removes it; a failing run keeps it. */
let workDir = '';
test.afterEach(async ({}, testInfo) => {
  if (!workDir) return;
  if (testInfo.status === testInfo.expectedStatus) fs.rmSync(workDir, { recursive: true, force: true });
  else console.log(`Milestone 1 failed; its files are in ${workDir}`);
});

const BODY = 'Twenty studios open their doors for one day. Watch screen printing, letterpress and riso demos, browse prints, and meet the people who make them. Free entry, all ages.';
const DETAILS = 'Saturday, May 16 · 10am–4pm · 412 Grove Street';

test('builds the Spring poster through the UI, saves and reopens it, and exports a PDF/X-4 that passes the golden checks', async ({ galley }, testInfo) => {
  requireTools();
  resetShots();
  const work = (workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-milestone1-')));
  const photoFile = path.join(work, 'photo.jpg');
  const pkg = path.join(work, 'Spring Poster.galley');
  const pdf = path.join(work, 'Spring Poster.pdf');
  await generatePhoto(photoFile); // a picture made by this test: no third-party image

  let { page, app } = galley;
  const ids: Record<string, string> = {};
  let zoom = 1;

  // ----------------------------------------------------------------------------------------------- 1. New Document
  await test.step('1. New Document (⌘N): Tabloid, 0.125 in bleed, slug, 3 columns', async () => {
    await page.keyboard.press('Meta+n');
    const dialog = page.getByTestId('new-document-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-field="preset"]').selectOption('tabloid');
    const type = async (field: string, text: string) => {
      await dialog.locator(`[data-field="${field}"]`).fill(text);
      await page.keyboard.press('Tab');
    };
    await type('bleed-top', '0.125'); // the four sides are linked: all of them
    await type('slug-top', '0.5');
    await type('columns', '3');
    await shot(page, '01-new-document-dialog');
    await dialog.getByTestId('dialog-ok').click();
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press('Meta+0'); // fit page in window
    await expect.poll(async () => (await getEditorState(page)).viewport.fit).toBe(true);
    await expect(page.getByTestId('page-summary')).toHaveText('Tabloid 11 × 17 in · bleed 0.125 in · 3 columns');
    const doc = await getDoc(page);
    expect(doc.pageOrder).toHaveLength(1);
    expect(doc.pages[doc.pageOrder[0]]).toMatchObject({
      width: 792,
      height: 1224,
      margins: { top: 36, right: 36, bottom: 36, left: 36 },
      columns: { count: 3, gutter: 12 },
      bleed: { top: 9, right: 9, bottom: 9, left: 9 },
      slug: { top: 36, right: 36, bottom: 36, left: 36 },
    });
    expect(Object.keys(doc.frames)).toEqual([]);
    zoom = (await getEditorState(page)).viewport.zoom;
    expect(zoom).toBeGreaterThan(0.3);
    expect(zoom).toBeLessThan(1);
    await shot(page, '02-empty-document');
  });
  const off = 2 / zoom; // two screen pixels, in points: close enough to a snap target to be pulled onto it

  // ---------------------------------------------------------------------------------------------------- 2. Swatches
  await test.step('2. Swatches panel: Warm Orange, Studio Blue and the spot PANTONE 185 C', async () => {
    await makeSwatch(page, { name: 'Warm Orange', kind: 'cmyk', values: [0, 60, 100, 0] });
    await makeSwatch(page, { name: 'Studio Blue', kind: 'cmyk', values: [100, 80, 0, 20] });
    await makeSwatch(page, { name: 'PANTONE 185 C', kind: 'spot', values: [0, 91, 76, 0] });
    const doc = await getDoc(page);
    for (const s of Object.values<any>(doc.swatches)) ids[s.name] = s.id;
    expect(doc.swatches[ids['Warm Orange']!]).toMatchObject({ type: 'cmyk', values: [0, 60, 100, 0] });
    expect(doc.swatches[ids['Studio Blue']!]).toMatchObject({ type: 'cmyk', values: [100, 80, 0, 20] });
    expect(doc.swatches[ids['PANTONE 185 C']!]).toMatchObject({ type: 'spot', values: [0, 91, 76, 0] });
    expect(doc.swatches.black).toMatchObject({ values: [0, 0, 0, 100] }); // the default black text uses: 100K
    await shot(page, '03-swatches', page.locator('[data-region="dock"]'));
  });

  // ------------------------------------------------------------------------------------------------------- 3. Draw
  await test.step('3a. Rectangle tool: the orange block, into the bleed (snaps to the bleed edge), exact height from the control strip', async () => {
    // pressed 2 screen px outside the top-left bleed corner and released 2 px outside the right bleed edge
    const r = await drawWith(page, 'rectangle', { x: -9 - off, y: -9 - off }, { x: 801 + off, y: 465 });
    ids.orange = r.id;
    expect(r.frame).toMatchObject({ type: 'rect', x: -9, y: -9, w: 810 }); // pulled onto the bleed edges: exact
    expect(near(r.frame.h, 474, 3)).toBe(true);
    await setGeometry(page, { h: 474 }); // exact bottom edge, typed into the control strip
    await paintFill(page, 'Warm Orange');
    await clearStroke(page);
    expect((await getDoc(page)).frames[r.id]).toMatchObject({ x: -9, y: -9, w: 810, h: 474, fill: { swatchId: ids['Warm Orange'], tint: 100 }, stroke: null });
  });

  await test.step('3b. Type tool: headline, subhead and details, typed in place', async () => {
    const headline = await drawWith(page, 'type', { x: 36 - off, y: 72 }, { x: 756 + off, y: 240 });
    ids.headline = headline.id;
    expect(headline.frame).toMatchObject({ type: 'text', x: 36, w: 720 }); // on the margins
    await typeInto(page, headline.id, 'SPRING');
    await setGeometry(page, { x: 36, y: 72, w: 720, h: 168 });

    const subhead = await drawWith(page, 'type', { x: 36 - off, y: 252 }, { x: 756 + off, y: 330 });
    ids.subhead = subhead.id;
    expect(subhead.frame).toMatchObject({ x: 36, w: 720 });
    expect(near(subhead.frame.y, 252, 3) && near(subhead.frame.h, 78, 5)).toBe(true);
    await typeInto(page, subhead.id, 'OPEN STUDIO');

    const details = await drawWith(page, 'type', { x: 36 - off, y: 357 }, { x: 756 + off, y: 387 });
    ids.details = details.id;
    expect(details.frame).toMatchObject({ x: 36, w: 720 });
    await typeInto(page, details.id, DETAILS);

    const doc = await getDoc(page);
    for (const [id, text] of [[ids.headline, 'SPRING'], [ids.subhead, 'OPEN STUDIO'], [ids.details, DETAILS]] as const) {
      expect(storyText(doc, doc.frames[id!].storyId)).toBe(text);
    }
    expect(doc.frames[ids.headline!]).toMatchObject({ x: 36, y: 72, w: 720, h: 168 });
  });

  await test.step('3c. Rectangle Frame tool: the photo frame snaps to both margins (the guides show), exact Y and H from the control strip', async () => {
    // pressed 2 screen px left of the left margin, and held 2 px right of the right margin: mid-drag, the guides show
    await drawWith(page, 'rectangle-frame', { x: 36 - off, y: 516 }, { x: 756 + off, y: 900 }, { hold: true });
    await expect(page.locator('.gl-smart-guide').first()).toBeVisible();
    // the guide is the right margin the pointer is snapped to (the press point snapped to the left margin once, at the start)
    const guides = await page.locator('.gl-smart-guide').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.axis}:${(e as HTMLElement).dataset.value}`));
    expect(guides).toEqual(expect.arrayContaining(['x:756']));
    await page.mouse.up();
    await flushInput(page);
    ids.photo = await selectedFrameId(page);
    const frame = (await getDoc(page)).frames[ids.photo];
    expect(frame).toMatchObject({ type: 'image', x: 36, w: 720, assetId: null });
    expect(near(frame.x + frame.w, 756, 0.001)).toBe(true); // exactly the margins, although the pointer was 2 px off each
    await setGeometry(page, { y: 516, h: 384 });
    expect((await getDoc(page)).frames[ids.photo]).toMatchObject({ x: 36, y: 516, w: 720, h: 384 });
  });

  await test.step('3d. ⌘D: place the generated photo (file dialog stubbed), then Fill Frame Proportionally', async () => {
    await stubDialogs(app, { open: [photoFile] });
    await page.keyboard.press('Meta+d');
    await expect.poll(async () => (await getDoc(page)).frames[ids.photo!].assetId).not.toBeNull();
    await flushInput(page);
    const fit = page.getByTestId('fitting-dropdown');
    await expect(fit).toBeVisible();
    await fit.selectOption('object.fit.fillProportionally'); // from the control strip's Fitting menu
    const doc = await getDoc(page);
    const frame = doc.frames[ids.photo!];
    const asset = doc.assets[frame.assetId];
    expect(asset).toMatchObject({ kind: 'image', path: 'assets/photo.jpg', width: 3000, height: 1700, ppi: 300 });
    expect(path.isAbsolute(asset.path)).toBe(false);
    // the 1.76:1 picture fills the 1.875:1 frame: full width, 408 pt tall, 12 pt cropped from the top and bottom
    expect(frame.content).toEqual({ x: 0, y: -12, w: 720, h: 408 });
    await expect(page.locator(`.galley-image[data-frame-id="${ids.photo}"] img`)).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  });

  await test.step('3e. Selection tool: click the photo; mid-build screenshot shows the selection and its handles', async () => {
    await chooseTool(page, 'select');
    await clickPage(page, { x: 396, y: 700 });
    expect((await getEditorState(page)).selection).toEqual([ids.photo]);
    await expect(page.locator('[data-handle]')).toHaveCount(8);
    await expect(page.getByTestId('selection-info')).toHaveText('Image frame · photo.jpg · 300 ppi effective');
    await shot(page, '04-mid-build-selection');
  });

  await test.step('3f. Type tool: body paragraph (snaps to the second column) and the URL', async () => {
    const body = await drawWith(page, 'type', { x: 36 - off, y: 951 }, { x: 512 + off, y: 1059 });
    ids.body = body.id;
    expect(body.frame).toMatchObject({ x: 36, w: 476 }); // the left margin to the right edge of column 2 (280 + 232)
    await typeInto(page, body.id, BODY);

    const url = await drawWith(page, 'type', { x: 36 - off, y: 1080 }, { x: 512 + off, y: 1107 });
    ids.url = url.id;
    expect(url.frame).toMatchObject({ x: 36, w: 476 });
    await typeInto(page, url.id, 'galleystudio.example/spring');
  });

  await test.step('3g. Ellipse tool: the circle, filled with the spot color, and a "FREE" text frame on it', async () => {
    // Pressed 6 pt above the body frame's top edge and released near the URL frame's bottom edge and the right margin: all three
    // pull the circle onto them, and the smart guides of the aligned objects show while the button is down.
    await drawWith(page, 'ellipse', { x: 596, y: 945 }, { x: 756 + off, y: 1105 }, { hold: true });
    await expect(page.locator('.gl-smart-guide').first()).toBeVisible();
    await shotWhileDragging(app, page, '05-snapping-mid-drag');
    await page.mouse.up();
    await flushInput(page);
    const eid = await selectedFrameId(page);
    const e = { id: eid, frame: (await getDoc(page)).frames[eid] };
    ids.ellipse = e.id;
    expect(e.frame).toMatchObject({ type: 'ellipse' });
    expect(near(e.frame.x + e.frame.w, 756, 0.001)).toBe(true);
    // on the top edge of the body frame and the bottom edge of the URL frame
    expect([near(e.frame.y, 951, 0.001), near(e.frame.y + e.frame.h, 1107, 0.001)]).toEqual([true, true]);
    expect(near(e.frame.w, 160, 4) && near(e.frame.h, 158, 8), JSON.stringify(e.frame)).toBe(true);
    await paintFill(page, 'PANTONE 185 C');
    await clearStroke(page);
    expect((await getDoc(page)).frames[e.id]).toMatchObject({ fill: { swatchId: ids['PANTONE 185 C'], tint: 100 }, stroke: null });

    const free = await drawWith(page, 'type', { x: 656, y: 1015 }, { x: 700, y: 1035 });
    ids.free = free.id;
    await typeInto(page, free.id, 'FREE');
  });

  await test.step('3h. Rectangle tool: the Studio Blue footer bar between the margins', async () => {
    const bar = await drawWith(page, 'rectangle', { x: 36 - off, y: 1140 }, { x: 756 + off, y: 1188 + off });
    ids.bar = bar.id;
    expect(bar.frame).toMatchObject({ x: 36, w: 720 });
    expect(near(bar.frame.y + bar.frame.h, 1188, 0.001)).toBe(true); // the bottom margin
    await paintFill(page, 'Studio Blue');
    await clearStroke(page);
    expect((await getDoc(page)).frames[bar.id]).toMatchObject({ fill: { swatchId: ids['Studio Blue'], tint: 100 }, stroke: null });
  });

  // ------------------------------------------------------------------------------------- the finished poster in the editor
  let savedModel: any;
  let savedJson = '';
  let beforeClose: Buffer;
  await test.step('4. The finished poster', async () => {
    await chooseTool(page, 'select');
    await page.keyboard.press('Meta+Shift+a'); // deselect all
    expect((await getEditorState(page)).selection).toEqual([]);
    await page.keyboard.press('Meta+0');
    const doc = await getDoc(page);
    expect(Object.keys(doc.frames)).toHaveLength(10); // orange block, headline, subhead, details, photo, body, URL, circle, FREE, bar
    const kinds = Object.values<any>(doc.frames).map((f) => f.type).sort();
    expect(kinds).toEqual(['ellipse', 'image', 'rect', 'rect', 'text', 'text', 'text', 'text', 'text', 'text']);
    // every text frame has its own story, and every paragraph resolves to the default text color: 100K black, [Black]
    const fills = await page.evaluate(() => {
      const g = (window as any).__galley;
      const d = g.store.getState().history.doc;
      return Object.values<any>(d.frames)
        .filter((f) => f.type === 'text')
        .flatMap((f) => (d.stories[f.storyId].doc.content ?? []).map((para: any) => g.model.resolveParagraph(d, para.attrs ?? {}).fill));
    });
    expect(fills.length).toBeGreaterThanOrEqual(6);
    for (const fill of fills) expect(fill).toEqual({ swatchId: 'black', tint: 100, overprint: false });
    expect(storyText(doc, doc.frames[ids.body!].storyId)).toBe(BODY);
    expect(storyText(doc, doc.frames[ids.free!].storyId)).toBe('FREE');
    await shot(page, '06-finished-poster');
  });

  // ------------------------------------------------------------------------------------------------------- 5. Save As
  await test.step('5a. Save As… to a temp .galley package (dialog stubbed)', async () => {
    await stubDialogs(app, { save: [pkg] });
    await clickMenuItem(app, 'file.saveAs');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(pkg);
    expect((await getEditorState(page)).dirty).toBe(false);
    for (const f of ['document.json', 'links.json', 'assets/photo.jpg']) expect(fs.existsSync(path.join(pkg, f)), f).toBe(true);
    savedJson = await getDocumentJson(page);
    expect(fs.readFileSync(path.join(pkg, 'document.json'), 'utf8')).toBe(savedJson);
    savedModel = await getModelDoc(page);
    expect(savedModel.meta.title).toBe('Spring Poster'); // the new document took its name from the file
    beforeClose = await settledPageShot(page);
  });

  await test.step('5b. Close (File › Close), relaunch, File › Open: the reopened document is the saved one', async () => {
    const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
    await clickMenuItem(app, 'file.close').catch(() => undefined); // the app exits while the call returns
    await closed; // e2e runs quit with the last window

    const second: GalleyApp = await launchApp({ open: null });
    app = second.app;
    page = second.page;
    galley.close = second.close; // so the fixture shuts the second app down at the end
    await stubDialogs(app, { open: [pkg], save: [pdf] });
    await expect(page.getByTestId('page-summary')).toHaveText(/Letter/); // a blank document: nothing carried over
    await clickMenuItem(app, 'file.open');
    await expect.poll(async () => (await getShellState(page)).packagePath).toBe(pkg);
    await page.keyboard.press('Meta+0');
    await expect.poll(async () => (await getDocumentJson(page)) === savedJson).toBe(true);

    // the model is the saved model, and the render is the saved render
    expect(await getModelDoc(page)).toEqual(savedModel);
    expect((await getEditorState(page)).dirty).toBe(false);
    const afterOpen = await settledPageShot(page);
    const diff = await diffPngs(beforeClose, afterOpen);
    expect(diff.significant, `the reopened document renders like the saved one (${JSON.stringify(diff)})`).toBe(0);
    expect(diff.differing).toBeLessThan(diff.width * diff.height * 0.5); // only resampling noise inside the photo may differ
    console.log(`reopened render vs saved render: ${diff.width} x ${diff.height} px, ${diff.differing} px differ at all, ${diff.significant} by more than 48/255, largest difference ${diff.maxDelta}/255`);

    // the photo link is relative: in the document, in links.json, and nothing in the package mentions the temp folder
    const doc = await getDoc(page);
    const asset = Object.values<any>(doc.assets)[0];
    expect(asset.path).toBe('assets/photo.jpg');
    const links = JSON.parse(fs.readFileSync(path.join(pkg, 'links.json'), 'utf8'));
    expect(Object.values<any>(links.links).map((l) => l.path)).toEqual(['assets/photo.jpg']);
    for (const f of ['document.json', 'links.json']) expect(fs.readFileSync(path.join(pkg, f), 'utf8')).not.toContain(work);
    expect((await getShellState(page)).missingLinks).toEqual([]);
    await expect(page.locator('.galley-image img')).toHaveCount(1);
    expect(await page.locator('.galley-image img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(3000);
    await shot(page, '07-reopened');
  });

  // ------------------------------------------------------------------------------------------------------- 6. Export
  await test.step('6. File › Export › PDF/X-4… (⌘E) with bleed and crop marks on (save dialog stubbed)', async () => {
    await page.keyboard.press('Meta+e');
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('export-bleed')).toBeChecked();
    await expect(page.getByTestId('export-marks')).toBeChecked();
    await shot(page, '08-export-dialog');
    await page.getByTestId('export-run').click();
    await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('export-path')).toHaveText(pdf);
    if ((await page.getByTestId('export-warnings').count()) > 0) console.log('export warnings:', await page.getByTestId('export-warnings').innerText());
    await page.getByTestId('export-done').click();
    await expect(dialog).toBeHidden();
    expect((await getEditorState(page)).dirty).toBe(false); // exporting does not touch the document
    expect(await getDocumentJson(page)).toBe(savedJson);
    expect(fs.readFileSync(pdf).subarray(0, 8).toString('latin1')).toBe('%PDF-1.6');
  });

  await test.step('7. The exported PDF passes the golden separation checks', async () => {
    // page boxes: the poster is 792 x 1224 pt; the sheet adds the 36 pt slug (marks on), the bleed box 9 pt per side
    const trim = pdfBox(pdf, 'TrimBox');
    const bleed = pdfBox(pdf, 'BleedBox');
    expect(pdfBox(pdf, 'MediaBox')).toEqual([0, 0, 864, 1296]);
    expect(trim).toEqual([36, 36, 828, 1260]);
    expect([trim[2]! - trim[0]!, trim[3]! - trim[1]!]).toEqual([792, 1224]);
    expect(bleed).toEqual([trim[0]! - 9, trim[1]! - 9, trim[2]! + 9, trim[3]! + 9]);
    const q = qpdfCheck(pdf);
    expect(q.ok, q.output).toBe(true);

    const result = measurePoster(pdf, pkg, path.join(work, 'measure'), work);
    const failed = result.checks.filter((c) => !c.pass).map((c) => `[${c.group}] ${c.name}: expected ${c.expected}, measured ${c.measured}`);
    expect(failed).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(30);
    const check = (pattern: RegExp) => {
      const found = result.checks.filter((c) => pattern.test(c.name));
      expect(found.length, `a check matching ${pattern}`).toBeGreaterThan(0);
      for (const c of found) expect(c.pass, `${c.name}: expected ${c.expected}, measured ${c.measured}`).toBe(true);
      return found;
    };
    check(/^qpdf --check/);
    check(/^TrimBox is exactly the page size/);
    check(/^BleedBox/);
    check(/^OutputIntent \/S \/GTS_PDFX/);
    check(/^XMP pdfxid:GTS_PDFX/);
    check(/^no DeviceRGB vector color/);
    check(/^spot colors have their own named plates/);
    check(/: text on paper is K only/); // the body, the URL: nothing but the Black plate
    check(/: ink reaches the bleed edge on the left side/);
    check(/: no ink beyond the bleed edge on the left side/);
    check(/^a crop mark prints on every plate/);

    const { patches, texts, plateNames } = result.measurements;
    const patch = (swatch: string) => {
      const found = patches.find((p) => p.swatch === swatch);
      expect(found, `a measured patch of ${swatch}`).toBeTruthy();
      return found!;
    };
    // each swatch reads its own ink on the plates, within 2 percentage points
    const expectInk = (name: string, measured: { C: number; M: number; Y: number; K: number }, expected: [number, number, number, number]) => {
      for (const [i, plate] of (['C', 'M', 'Y', 'K'] as const).entries()) {
        expect(Math.abs(measured[plate] - expected[i]!), `${name}: ${plate} measured ${measured[plate]}, swatch ${expected[i]}`).toBeLessThanOrEqual(2);
      }
    };
    const orange = patch('Warm Orange');
    expectInk('Warm Orange', orange.measured, [0, 60, 100, 0]);
    const blue = patch('Studio Blue');
    expectInk('Studio Blue', blue.measured, [100, 80, 0, 20]);
    // the spot color is on its own plate, full strength, and nowhere in the process plates
    expect(plateNames).toEqual(['PANTONE 185 C']);
    const spot = patch('PANTONE 185 C');
    expectInk('PANTONE 185 C (process plates)', spot.measured, [0, 0, 0, 0]);
    expect(Math.abs((spot.measured.spots['PANTONE 185 C'] ?? 0) - 100), 'the PANTONE 185 C plate').toBeLessThanOrEqual(2);
    // the body copy is the default 100K black: it prints on the Black plate and on no other
    const body = texts.find((t) => t.text.startsWith('Twenty studios'))!;
    expect(body, 'the body text was measured').toBeTruthy();
    expect([body.max.C, body.max.M, body.max.Y, ...Object.values(body.max.spots)]).toEqual([0, 0, 0, 0]); // every plate but Black is empty
    expect(body.max.K).toBeGreaterThanOrEqual(99);
    expect(texts.every((t) => t.pass)).toBe(true);

    const fmt = (m: { C: number; M: number; Y: number; K: number; spots: Record<string, number> }) => `C${m.C} M${m.M} Y${m.Y} K${m.K}${Object.entries(m.spots).map(([n, v]) => ` ${n} ${v}`).join('')}`;
    console.log(
      [
        `Warm Orange measured ${fmt(orange.measured)} (swatch C0 M60 Y100 K0)`,
        `Studio Blue measured ${fmt(blue.measured)} (swatch C100 M80 Y0 K20)`,
        `PANTONE 185 C measured ${fmt(spot.measured)} (own plate; swatch alternate C0 M91 Y76 K0)`,
        `spot plates: ${plateNames.join(', ')}`,
        ...texts.map((t) => `text "${t.text}" max ${fmt(t.max)}`),
        `MediaBox ${pdfBox(pdf, 'MediaBox').join(' ')}  TrimBox ${trim.join(' ')}  BleedBox ${bleed.join(' ')}`,
        `golden checks: ${result.checks.filter((c) => c.pass).length}/${result.checks.length} passed; qpdf --check: ${q.ok ? 'clean' : 'ERRORS'}`,
      ].join('\n'),
    );

    await testInfo.attach('poster-measurements.json', { body: JSON.stringify(result.measurements, null, 2), contentType: 'application/json' });
    renderPdf(pdf, '09-exported-pdf');
    const plate = path.join(work, 'plate-PANTONE-185-C.png');
    expect(fs.existsSync(plate)).toBe(true);
    fs.copyFileSync(plate, path.join(SHOTS_DIR, '10-plate-PANTONE-185-C.png'));
  });
});
