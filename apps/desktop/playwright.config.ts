import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real Electron app (the built output in out/, so run `npm run build` first; the root
 * `npm run test:e2e` does). Specs are named `*.e2e.ts` and live under e2e/<area>/ so lanes never collide:
 *   e2e/foundation  lane F        e2e/canvas  lane B        e2e/shell  lane C
 *   e2e/text        lane T        e2e/styles  lane S        e2e/fonts  lane N
 *
 * Screenshot baselines are committed under e2e/__screenshots__/<spec path>/<name>.png. One platform (macOS) is
 * supported, so there is no platform suffix. Update them deliberately with:
 *   npm run test:e2e -w @galley/desktop -- --update-snapshots
 * Everything else a test writes (inspection screenshots, failure diffs) goes to test-results/, which is gitignored.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results',
  snapshotDir: 'e2e/__screenshots__',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',
  // One Electron app per test; a single worker keeps windows from fighting over focus and the GPU.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Text anti-aliasing is deterministic on one machine; this tolerates only sub-pixel noise.
      maxDiffPixelRatio: 0.002,
    },
  },
});
