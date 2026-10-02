import { expect } from '@playwright/test';
import path from 'node:path';
import { test } from '../helpers/fixtures';
import { REPO_ROOT } from '../helpers/launch';
import { getDocument } from '../helpers/app-state';
import { snap, waitForStable } from '../helpers/screenshot';

/**
 * P2-01: every v1 fixture (fixtures/v1, frozen at formatVersion 1) migrates to v2 when the editor opens it and renders the
 * same as it did before. The baselines in e2e/__screenshots__/text/migration.e2e.ts/ were captured from the v1 renderer
 * (the Phase 1 build) before any v2 change, so a match here is a match with how v1 drew the page. No pixel may differ.
 */
const V1 = ['poster-basic', 'swatch-chart', 'typography-marks'] as const;

for (const name of V1) {
  test.describe(`v1 fixture ${name}`, () => {
    test.use({ open: path.join(REPO_ROOT, 'fixtures', 'v1', `${name}.galley`) });

    test('opens, migrates to the current format, and renders pixel for pixel like v1', async ({ galley }, testInfo) => {
      const { page } = galley;
      await page.waitForSelector('.galley-page[data-ready="true"]');
      const doc = await getDocument(page);
      expect(doc.formatVersion).toBe(2);
      expect(doc.paragraphStyles['basic-paragraph']).toBeDefined();
      expect(Object.values<any>(doc.stories).every((s) => s.frameIds.length >= 1)).toBe(true);
      await snap(page, `migration-${name}`, { testInfo, target: page.locator('.galley-page') });
      await waitForStable(page);
      await expect(page.locator('.galley-page')).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 0 });
    });
  });
}
