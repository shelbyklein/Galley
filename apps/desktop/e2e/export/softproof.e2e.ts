import fs from 'node:fs';
import { FIXTURES, launchApp } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { expectBaseline, snap, waitForStable } from '../helpers/screenshot';
import { scratchDir, softProofViaIpc, stubSaveDialog } from './pdf';

// P1-07: CMYK and spot swatches are shown through the output profile, and the status bar names it.
// With no profile available the app falls back to Ghostscript's default_cmyk.icc and says so in the status bar.
const GRACOL = '/Library/Application Support/Adobe/Color/Profiles/Recommended/CoatedGRACoL2006.icc';
const hasGracol = fs.existsSync(GRACOL);
const NAIVE_ORANGE = 'rgb(255 102 0)'; // the temporary conversion of C0 M60 Y100 K0 that this task replaces

/** The fill the editor draws the poster's orange block with. */
const orangeFill = (page: import('@playwright/test').Page) => page.locator('rect[data-frame-id="orange-block"]').getAttribute('fill');

test.use({ open: FIXTURES.posterBasic });

test('swatches are drawn through the output profile, final by the time the page is ready, and the status bar names the profile', async ({ galley }, testInfo) => {
  const { page } = galley;
  await waitForStable(page);
  const status = page.getByTestId('status-profile');
  await expect(status).toBeVisible();
  if (hasGracol) {
    await expect(status).toHaveText('Proof: Coated GRACoL 2006');
    await expect(status).toHaveAttribute('data-profile-kind', 'press');
  } else {
    await expect(status).toHaveAttribute('data-profile-kind', 'fallback');
  }

  // the orange block is no longer the naive conversion, and it is exactly what the main process's LittleCMS answers
  const fill = await orangeFill(page);
  expect(fill).not.toBe(NAIVE_ORANGE);
  const proofed = await softProofViaIpc(page, [[0, 60, 100, 0]]);
  expect(proofed).not.toBeNull();
  expect(fill).toBe(`rgb(${proofed![0]!.join(' ')})`);
  if (hasGracol) expect(proofed![0]).toEqual([241, 126, 5]); // Ghostscript's conversion of C0 M60 Y100 K0 through Coated GRACoL 2006 (packages/prepress/test/softproof.test.ts)

  // spot colors are proofed through their CMYK alternate, tints at their strength: the ellipse is PANTONE 185 C (C0 M91 Y76 K0)
  const ellipse = await page.locator('ellipse[data-frame-id="free-ellipse"]').getAttribute('fill');
  const ellipseProof = await softProofViaIpc(page, [[0, 91, 76, 0]]);
  expect(ellipse).toBe(`rgb(${ellipseProof![0]!.join(' ')})`);

  await snap(page, 'poster-soft-proof', { testInfo });
  await expectBaseline(page, 'status-bar-profile', { target: page.locator('[data-region="statusbar"]') });
});

test.describe('without the Adobe profile', () => {
  test('falls back to default_cmyk.icc, and the status bar says so', async ({}, testInfo) => {
    const app = await launchApp({ open: FIXTURES.posterBasic, env: { GALLEY_PROFILE_DIRS: '/galley-no-such-folder' } });
    try {
      const { page } = app;
      await waitForStable(page);
      const status = page.getByTestId('status-profile');
      await expect(status).toHaveAttribute('data-profile-kind', 'fallback');
      await expect(status).toContainText('default_cmyk.icc');
      await expect(status).toContainText('Ghostscript default CMYK');
      await expect(status).toHaveAttribute('title', /GRACoL 2006 was not found/);
      const fill = await orangeFill(page);
      expect(fill).not.toBe(NAIVE_ORANGE); // still a real profile conversion
      const proofed = await softProofViaIpc(page, [[0, 60, 100, 0]]);
      expect(fill).toBe(`rgb(${proofed![0]!.join(' ')})`);
      await snap(page, 'status-bar-fallback', { testInfo, target: page.locator('[data-region="statusbar"]') });
      await expectBaseline(page, 'status-bar-fallback', { target: page.locator('[data-region="statusbar"]') });
    } finally {
      await app.close();
    }
  });

  test('with no CMYK profile at all the colors stay approximate, the status bar says so, and PDF export explains why it cannot run', async () => {
    const app = await launchApp({ open: FIXTURES.posterBasic, env: { GALLEY_PROFILE_DIRS: '/galley-no-such-folder', GALLEY_GS_ICC_DIR: '' } });
    const dir = scratchDir();
    try {
      const { page } = app;
      await waitForStable(page);
      const status = page.getByTestId('status-profile');
      await expect(status).toHaveAttribute('data-profile-kind', 'none');
      await expect(status).toContainText('no output profile');
      expect(await orangeFill(page)).toBe(NAIVE_ORANGE);

      await stubSaveDialog(app.app, { filePath: `${dir}/never.pdf` });
      await page.keyboard.press('Meta+e');
      await page.getByTestId('export-run').click();
      await expect(page.getByTestId('export-error')).toContainText('No CMYK output profile');
      expect(fs.existsSync(`${dir}/never.pdf`)).toBe(false);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
