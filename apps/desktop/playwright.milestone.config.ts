import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Milestone suites (`npm run test:milestone1`): long end-to-end journeys that build a whole document through the UI. They
 * are not part of `npm run test:e2e` (their files end in `.milestone.ts`, which the default config does not match).
 *
 * Output: Playwright clears its `outputDir` at the start of every run, so this config keeps its own folder
 * (test-results/milestone-run) and a milestone run leaves the other results in test-results/ alone. The spec writes its
 * inspection screenshots to test-results/milestone1/ itself. The reverse is not true: a default `npm run test:e2e` clears
 * all of test-results/, including milestone1/, so look at the screenshots before running it again.
 */
export default defineConfig({
  ...base,
  testDir: 'e2e/milestone',
  testMatch: '**/*.milestone.ts',
  outputDir: 'test-results/milestone-run',
  // A journey takes a minute or two: a new document, a poster's worth of drawing, a save, a restart and an export.
  timeout: 360_000,
  expect: { ...base.expect, timeout: 15_000 },
});
