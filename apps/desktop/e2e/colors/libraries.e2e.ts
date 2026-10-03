import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../helpers/fixtures';
import { getDocumentJson, getEditorState, runCommand } from '../helpers/app-state';
import { REPO_ROOT } from '../helpers/launch';
import { getDoc, loadDoc } from '../canvas/helpers';
import { dispatchModel, stubDialogs } from '../shell/helpers';
import { snap } from '../helpers/screenshot';
import { failures, goldenChecks, softProofViaIpc } from '../export/pdf';

test.use({ open: null });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'galley-library-e2e-'));
const library = {
  format: 'galley-swatch-library', version: 1,
  swatches: [
    { id: 'shade', type: 'tint', name: 'Studio Ink 40%', baseId: 'ink', percent: 40 },
    { id: 'process', type: 'cmyk', name: 'Studio Blue', values: [100, 40, 0, 15] },
    { id: 'ink', type: 'spot', name: 'Studio Ink', values: [0, 90, 40, 0] },
  ],
};
const menu = async (page: any, action: string) => { await page.getByTestId('swatches-menu').click(); await page.getByRole('menuitem', { name: action }).click(); };
const userColors = async (page: any) => Object.values<any>((await getDoc(page)).swatches).filter((s) => !['paper', 'black', 'registration'].includes(s.id));

test('native libraries round-trip CMYK/spot/tint, import atomically, preserve collisions and reject malformed files', async ({ galley }, testInfo) => {
  const { page, app } = galley; const dir = temp(); const source = path.join(dir, 'studio.json'); fs.writeFileSync(source, JSON.stringify(library));
  await loadDoc(page);
  const before = await getDocumentJson(page); const steps = (await getEditorState(page)).undoSteps;
  await stubDialogs(app, { open: [source] }); await menu(page, 'Load Swatch Library…');
  await expect.poll(async () => (await userColors(page)).length).toBe(3);
  expect((await getEditorState(page)).undoSteps).toBe(steps + 1);
  const colors = await userColors(page);
  const spot = colors.find((s) => s.type === 'spot'); const tint = colors.find((s) => s.type === 'tint');
  expect(spot.values).toEqual([0, 90, 40, 0]); expect(tint.baseId).toBe(spot.id); expect(tint.percent).toBe(40);
  expect(colors.every((s) => !['shade', 'process', 'ink'].includes(s.id))).toBe(true);
  await snap(page, 'phase3-swatch-library', { testInfo });
  const saved = path.join(dir, 'saved.json'); await stubDialogs(app, { save: [saved] }); await menu(page, 'Save Swatch Library…');
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  const roundtrip = JSON.parse(fs.readFileSync(saved, 'utf8'));
  expect(roundtrip).toMatchObject({ format: 'galley-swatch-library', version: 1 });
  expect(roundtrip.swatches).toEqual(colors);
  await page.keyboard.press('Meta+z'); expect(await getDocumentJson(page)).toBe(before);
  await page.keyboard.press('Meta+Shift+z'); expect(await userColors(page)).toEqual(colors);
  // A duplicate library reuses definitions; no command or second spot plate appears.
  const count = (await getEditorState(page)).undoSteps;
  await stubDialogs(app, { open: [saved] }); await menu(page, 'Load Swatch Library…');
  await expect(page.getByTestId('notices')).toContainText('0 added, 3 reused');
  expect((await getEditorState(page)).undoSteps).toBe(count);
  expect(await userColors(page)).toEqual(colors);
  // Conflict changes neither an existing process swatch nor its tint/spot relationships.
  const conflict = path.join(dir, 'conflict.json'); fs.writeFileSync(conflict, JSON.stringify({ ...library, swatches: [{ ...library.swatches[1], values: [0, 0, 0, 80] }] }));
  await stubDialogs(app, { open: [conflict] }); await menu(page, 'Load Swatch Library…');
  await expect.poll(async () => (await userColors(page)).length).toBe(4);
  expect((await getDoc(page)).swatches[colors.find((s) => s.type === 'cmyk').id].values).toEqual([100, 40, 0, 15]);
  expect((await userColors(page)).find((s) => s.name === 'Studio Blue 2').values).toEqual([0, 0, 0, 80]);
  const snapshot = await getDocumentJson(page);
  const bad = path.join(dir, 'bad.json');
  for (const data of ['not json', JSON.stringify({ ...library, version: 2 }), JSON.stringify({ ...library, swatches: [{ ...library.swatches[2], values: [0, 20, 40, 0] }] }), JSON.stringify({ ...library, swatches: [library.swatches[0]] })]) {
    await page.evaluate(() => { const shell = (window as any).__galleyShell.store; shell.setState({ notices: [] }); });
    fs.writeFileSync(bad, data); await stubDialogs(app, { open: [bad] }); await menu(page, 'Load Swatch Library…');
    await expect(page.locator('[data-panel="swatches"]')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('notices')).toContainText('Could not load swatch library');
    expect(await getDocumentJson(page)).toBe(snapshot);
  }
  await stubDialogs(app, {}); await menu(page, 'Load Swatch Library…'); await expect(page.locator('[data-panel="swatches"]')).toHaveAttribute('aria-busy', 'false'); expect(await getDocumentJson(page)).toBe(snapshot);
  const nonexistent = path.join(dir, 'canceled.json'); await menu(page, 'Save Swatch Library…'); await expect(page.locator('[data-panel="swatches"]')).toHaveAttribute('aria-busy', 'false'); expect(fs.existsSync(nonexistent)).toBe(false);
  // A fresh document reads the saved file with fresh ids and preserved relationships.
  await loadDoc(page); await stubDialogs(app, { open: [saved] }); await menu(page, 'Load Swatch Library…');
  await expect.poll(async () => (await userColors(page)).length).toBe(3);
  const fresh = await userColors(page);
  expect(fresh.map((s) => s.name)).toEqual(colors.map((s) => s.name));
  expect(fresh.find((s) => s.type === 'tint').baseId).toBe(fresh.find((s) => s.type === 'spot').id);
});

test('an identical library keeps the spot/tint golden PDF plates unchanged', async ({ galley }) => {
  const { page, app } = galley; const dir = temp();
  const pkg = path.join(REPO_ROOT, 'fixtures/golden/swatch-chart.galley');
  await stubDialogs(app, { open: [pkg] }); await runCommand(page, 'file.open');
  const original = await getDocumentJson(page);
  const saved = path.join(dir, 'chart.json'); await stubDialogs(app, { save: [saved] }); await menu(page, 'Save Swatch Library…');
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  await stubDialogs(app, { open: [saved] }); await menu(page, 'Load Swatch Library…');
  await expect(page.getByTestId('notices')).toContainText('0 added'); expect(await getDocumentJson(page)).toBe(original);
  const out = path.join(dir, 'chart.pdf'); await stubDialogs(app, { save: [out] });
  const files = await page.evaluate(() => { const g = (window as any).__galley; return g.model.serializeDocument(g.store.getState().history.doc); });
  const result = await page.evaluate((files) => (window as any).galley.press.exportPdf({ files, suggestedName: 'Chart', options: { bleed: true, marks: true } }), files);
  expect(result.status).toBe('saved');
  const expectedSpots = Object.values<any>((await getDoc(page)).swatches).filter((s) => s.type === 'spot').map((s) => s.name).sort();
  expect(result.summary.spots.slice().sort()).toEqual(expectedSpots);
  const checks = goldenChecks(out, pkg, { bleed: true, marks: true }, path.join(dir, 'golden'));
  expect(checks.length).toBeGreaterThan(50); expect(failures(checks)).toEqual([]);
});

test('draft process, spot and tint previews use the current ICC-proofed ink', async ({ galley }, testInfo) => {
  const { page } = galley; await loadDoc(page);
  await page.getByTestId('swatches-new').click();
  const dialog = page.getByTestId('swatch-dialog');
  for (const [axis, value] of [['c', '10'], ['m', '50'], ['y', '90'], ['k', '5']]) {
    await dialog.locator(`[data-field="${axis}"]`).fill(value!); await dialog.locator(`[data-field="${axis}"]`).press('Tab');
  }
  const proof = await softProofViaIpc(page, [[10, 50, 90, 5]]); expect(proof).not.toBeNull();
  const preview = dialog.getByTestId('swatch-preview'); await expect(preview).toHaveAttribute('data-proofed', 'true');
  await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(`rgb(${proof![0]!.join(', ')})`);
  // Rapid drafts use the latest ink even if earlier answers finish later.
  for (const value of ['20', '70', '30']) { await dialog.locator('[data-field="m"]').fill(value); await dialog.locator('[data-field="m"]').press('Tab'); }
  const latest = await softProofViaIpc(page, [[10, 30, 90, 5]]);
  await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(`rgb(${latest![0]!.join(', ')})`);
  await dialog.locator('[data-field="type"]').selectOption('spot');
  await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(`rgb(${latest![0]!.join(', ')})`);
  await snap(page, 'phase3-swatch-proofed-draft', { testInfo, target: dialog });
  await dialog.getByTestId('dialog-cancel').click();
  await dispatchModel(page, 'addSwatch', { swatch: { id: 'proofspot', name: 'Proof Ink', type: 'spot', values: [0, 90, 40, 0] } });
  await dispatchModel(page, 'addSwatch', { swatch: { id: 'prooftint', name: 'Proof Ink 40%', type: 'tint', baseId: 'proofspot', percent: 40 } });
  await page.locator('[data-panel="swatches"] [data-swatch-id="prooftint"]').dblclick();
  const tintProof = await softProofViaIpc(page, [[0, 36, 16, 0]]);
  await expect.poll(() => dialog.getByTestId('swatch-preview').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(`rgb(${tintProof![0]!.join(', ')})`);
  await snap(page, 'phase3-swatch-proofed-tint', { testInfo, target: dialog });
  await dialog.getByTestId('dialog-cancel').click();
});

test('a delayed library load cannot import into another document', async ({ galley }) => {
  const { page, app } = galley; const dir = temp(); const source = path.join(dir, 'library.json'); fs.writeFileSync(source, JSON.stringify(library));
  await loadDoc(page);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = (() => new Promise((resolve) => { (globalThis as any).__resolveLibrary = resolve; })) as any; });
  await menu(page, 'Load Swatch Library…');
  await expect(page.locator('[data-panel="swatches"]')).toHaveAttribute('aria-busy', 'true');
  await loadDoc(page); const snapshot = await getDocumentJson(page);
  await app.evaluate((_e, source) => (globalThis as any).__resolveLibrary({ canceled: false, filePaths: [source] }), source);
  // IPC returns after the switch, but the import command never runs.
  await expect(page.locator('[data-panel="swatches"]')).toHaveAttribute('aria-busy', 'false');
  expect(await getDocumentJson(page)).toBe(snapshot);
  expect((await getEditorState(page)).undoSteps).toBe(0);
});
