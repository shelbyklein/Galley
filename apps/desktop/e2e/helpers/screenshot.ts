import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './launch';

/** Where inspection screenshots go (gitignored). Open them with an image viewer to see what a test saw. */
export const SCREENS_DIR = path.join(APP_DIR, 'test-results', 'screens');

/**
 * Wait until what is on screen is final: web fonts loaded, every <img> decoded, and two animation frames painted.
 * Call before any screenshot; `snap` and `expectBaseline` do it for you.
 */
export async function waitForStable(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => (img.decode ? img.decode().catch(() => undefined) : undefined)),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

type Target = Page | Locator;

/**
 * Save a screenshot for a human (or an agent with an image viewer) to inspect: SCREENS_DIR/<name>.png at 1 CSS
 * pixel per image pixel. Also attaches it to the Playwright report. Returns the file path.
 */
export async function snap(page: Page, name: string, options: { target?: Target; testInfo?: TestInfo } = {}): Promise<string> {
  await waitForStable(page);
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  const file = path.join(SCREENS_DIR, `${name}.png`);
  const target = options.target ?? page;
  await target.screenshot({ path: file, scale: 'css', animations: 'disabled', caret: 'hide' });
  if (options.testInfo) await options.testInfo.attach(name, { path: file, contentType: 'image/png' });
  return file;
}

/**
 * Assert the page (or a locator) matches the committed baseline e2e/__screenshots__/<spec>/<name>.png.
 * The first run, or a run with --update-snapshots, writes the baseline. Always inspect a new baseline by eye.
 */
export async function expectBaseline(page: Page, name: string, options: { target?: Target } = {}): Promise<void> {
  await waitForStable(page);
  const target = options.target ?? page;
  await expect(target).toHaveScreenshot(`${name}.png`);
}
