import { test as base, expect } from '@playwright/test';
import { FIXTURES, launchApp, type GalleyApp } from './launch';

interface Options {
  /** Package the editor opens at start; `null` for none. Override per file or describe block with `test.use({ open: ... })`. */
  open: string | null;
}

/**
 * The e2e `test`: every test gets a fresh app as `galley` and it is closed afterwards.
 *
 *   import { test, expect } from '../helpers/fixtures';
 *   test.use({ open: FIXTURES.posterBasic });
 *   test('...', async ({ galley }) => { const { page } = galley; ... });
 */
export const test = base.extend<{ galley: GalleyApp } & Options>({
  open: [FIXTURES.posterBasic, { option: true }],
  galley: async ({ open }, use) => {
    const galley = await launchApp({ open });
    try {
      await use(galley);
    } finally {
      await galley.close();
    }
  },
});

export { expect };
