import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';

/** apps/desktop */
export const APP_DIR = path.resolve(__dirname, '../..');
/** The repository root. */
export const REPO_ROOT = path.resolve(APP_DIR, '../..');

/** Documents committed under fixtures/. */
export const FIXTURES = {
  posterBasic: path.join(REPO_ROOT, 'fixtures', 'poster-basic.galley'),
} as const;

export interface LaunchOptions {
  /**
   * Which `.galley` package the editor opens at start. `null` starts with no document.
   * (Temporary: lane C replaces the GALLEY_OPEN hook with real file handling.)
   */
  open?: string | null;
  /** Extra environment variables for the app process. */
  env?: Record<string, string>;
  /** Extra command-line arguments after the app path. */
  args?: string[];
}

export interface GalleyApp {
  app: ElectronApplication;
  /** The editor window. */
  page: Page;
  close(): Promise<void>;
}

/**
 * Launch the built Electron app (apps/desktop/out/main/index.js) with the e2e switches on:
 *   GALLEY_E2E=1  fixed 1:1 device scale factor, so screenshots do not depend on the display
 * and wait until the editor shell has mounted.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<GalleyApp> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.GALLEY_E2E = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL; // always test the built renderer, never a dev server
  if (options.open) env.GALLEY_OPEN = options.open;
  else delete env.GALLEY_OPEN;
  Object.assign(env, options.env);

  const app = await electron.launch({
    // `require('electron')` is the path to the Electron binary (it downloads it on first use).
    executablePath: require('electron') as unknown as string,
    args: [APP_DIR, ...(options.args ?? [])],
    cwd: APP_DIR,
    env,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"]');
  return {
    app,
    page,
    close: async () => {
      await app.close().catch(() => {});
    },
  };
}
