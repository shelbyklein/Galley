import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getDocument, getDocumentJson, getEditorState } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';
import { domLines, failures, goldenChecks, pdfBox, pdfLines, scratchDir, stubSaveDialog } from './pdf';

// P1-06: File > Export > PDF/X-4… (⌘E): the dialog, the hidden export window, printToPDF, prepress and the save dialog
// (stubbed here). The exported file must pass the golden checks and have exact page boxes.
test.use({ open: FIXTURES.posterBasic });

test('⌘E opens the dialog; exporting the poster writes a PDF/X-4 that passes the golden checks', async ({ galley }, testInfo) => {
  const { page, app } = galley;
  const dir = scratchDir();
  const out = path.join(dir, 'poster.pdf');
  await stubSaveDialog(app, { filePath: out });
  const before = await getDocumentJson(page);

  await page.waitForSelector('.galley-page[data-ready="true"]');
  await page.keyboard.press('Meta+e');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-phase', 'options');
  await expect(page.getByTestId('export-bleed')).toBeChecked();
  await expect(page.getByTestId('export-marks')).toBeChecked();
  await snap(page, 'export-dialog-options', { testInfo });
  await expectBaseline(page, 'export-dialog-options', { target: dialog });

  await page.getByTestId('export-run').click();
  await expect(dialog).toHaveAttribute('data-phase', /running|done/);
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('export-path')).toHaveText(out);
  await snap(page, 'export-dialog-done', { testInfo });

  // the file: exists, exact boxes, and every golden check passes
  expect(fs.existsSync(out)).toBe(true);
  expect(fs.statSync(out).size).toBeGreaterThan(100_000);
  expect(fs.readFileSync(out).subarray(0, 8).toString('latin1')).toBe('%PDF-1.6');
  expect(pdfBox(out, 'MediaBox')).toEqual([0, 0, 864, 1296]);
  expect(pdfBox(out, 'TrimBox')).toEqual([36, 36, 828, 1260]); // exactly the 792 x 1224 pt page
  expect(pdfBox(out, 'BleedBox')).toEqual([27, 27, 837, 1269]);
  const checks = goldenChecks(out, FIXTURES.posterBasic, { bleed: true, marks: true }, path.join(dir, 'work'));
  expect(checks.length).toBeGreaterThan(30);
  expect(failures(checks)).toEqual([]);

  // exporting does not touch the document
  expect(await getDocumentJson(page)).toBe(before);
  expect((await getEditorState(page)).dirty).toBe(false);

  await page.getByTestId('export-done').click();
  await expect(dialog).toBeHidden();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with bleed off the BleedBox equals the TrimBox and the art is cut at the trim edge', async ({ galley }) => {
  const { page, app } = galley;
  const dir = scratchDir();
  const out = path.join(dir, 'poster-trim.pdf');
  await stubSaveDialog(app, { filePath: out });
  await page.waitForSelector('.galley-page[data-ready="true"]');
  await page.keyboard.press('Meta+e');
  await page.getByTestId('export-bleed').uncheck();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 45_000 });

  expect(pdfBox(out, 'BleedBox')).toEqual(pdfBox(out, 'TrimBox'));
  expect(pdfBox(out, 'TrimBox')).toEqual([36, 36, 828, 1260]); // marks still on: the sheet keeps the poster's 36 pt slug
  const checks = goldenChecks(out, FIXTURES.posterBasic, { bleed: false, marks: true }, path.join(dir, 'work'));
  expect(failures(checks)).toEqual([]);
  expect(checks.some((c) => c.name.includes('no ink beyond the trim edge'))).toBe(true); // the orange block no longer prints in the bleed
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with crop marks off the PDF has no /All separation marks, and the sheet is trim plus bleed', async ({ galley }) => {
  const { page, app } = galley;
  const dir = scratchDir();
  const out = path.join(dir, 'poster-nomarks.pdf');
  await stubSaveDialog(app, { filePath: out });
  await page.waitForSelector('.galley-page[data-ready="true"]');
  await page.keyboard.press('Meta+e');
  await page.getByTestId('export-marks').uncheck();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 45_000 });

  expect(pdfBox(out, 'MediaBox')).toEqual([0, 0, 810, 1242]); // 792 x 1224 plus 9 pt of bleed on every side
  expect(pdfBox(out, 'TrimBox')).toEqual([9, 9, 801, 1233]);
  expect(pdfBox(out, 'BleedBox')).toEqual([0, 0, 810, 1242]);
  expect(fs.readFileSync(out).includes('/All')).toBe(false); // no registration color anywhere in the file
  const checks = goldenChecks(out, FIXTURES.posterBasic, { bleed: true, marks: false }, path.join(dir, 'work'));
  expect(failures(checks)).toEqual([]);
  expect(checks.find((c) => c.name.startsWith('no /Separation /All marks'))?.pass).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('text breaks into the same lines on screen and in the PDF, at the same line pitch', async ({ galley }) => {
  const { page, app } = galley;
  const dir = scratchDir();
  const out = path.join(dir, 'poster-lines.pdf');
  await stubSaveDialog(app, { filePath: out });
  await page.waitForSelector('.galley-page[data-ready="true"]');
  const screen = await domLines(page); // the editor's layout, on a scaled canvas
  await page.keyboard.press('Meta+e');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 45_000 });

  const doc = await getDocument<{ frames: Record<string, { type: string; x: number; y: number; w: number; h: number }> }>(page);
  const origin = 36; // the poster's slug: the page's (0, 0) is at (36, 36) on the exported sheet
  let compared = 0;
  for (const [id, lines] of Object.entries(screen)) {
    const f = doc.frames[id]!;
    const pdf = pdfLines(out, { x0: origin + f.x, y0: origin + f.y, x1: origin + f.x + f.w, y1: origin + f.y + f.h });
    expect(pdf.map((l) => l.text.replace(/-$/, '')), `lines of ${id}`).toEqual(lines.map((l) => l.text.replace(/-$/, '')));
    // the distance between consecutive lines (the leading) agrees to well under a pixel
    for (let i = 1; i < lines.length; i++) expect(Math.abs(pdf[i]!.top - pdf[i - 1]!.top - (lines[i]!.top - lines[i - 1]!.top)), `line pitch in ${id}`).toBeLessThan(0.06);
    compared += lines.length;
  }
  expect(compared).toBe(9); // 6 text frames: one line each, and the body paragraph's 4
  fs.rmSync(dir, { recursive: true, force: true });
});

test('canceling the save dialog leaves the options open and writes nothing', async ({ galley }) => {
  const { page, app } = galley;
  await stubSaveDialog(app, { canceled: true });
  await page.keyboard.press('Meta+e');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-phase', 'options');
  await expect(page.getByTestId('export-result')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toBeHidden();
});

test('a failure is shown in the dialog, with a way back to the options', async ({ galley }, testInfo) => {
  const { page, app } = galley;
  // a folder that cannot be created
  await stubSaveDialog(app, { filePath: '/galley-no-such-root/nested/poster.pdf' });
  await page.keyboard.press('Meta+e');
  await page.getByTestId('export-run').click();
  const error = page.getByTestId('export-error');
  await expect(error).toBeVisible({ timeout: 45_000 });
  await expect(error).toContainText(/Could not save the PDF/);
  await expect(error).toContainText(/EACCES|ENOENT|EROFS|permission|read-only|no such/i);
  await snap(page, 'export-dialog-error', { testInfo });
  await page.getByTestId('export-retry').click();
  await expect(page.getByTestId('export-dialog')).toHaveAttribute('data-phase', 'options');
});
