// Launching the built Galley app from a script, and running the export pipeline in it. Shared by `npm run test:golden`,
// `npm run test:geometry` and the export e2e. Lane A.
//
// The app is started with GALLEY_E2E=1, which makes the main process expose `globalThis.__galleyExport` (see
// apps/desktop/src/main/export/handlers.ts); `app.evaluate` runs the same pipeline as File > Export > PDF/X-4, without the
// editor window or the save dialog.
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DocumentFiles } from '@galley/model';

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const APP_DIR = path.join(REPO_ROOT, 'apps/desktop');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'fixtures');

/** Build the app (electron-vite only, a few seconds) so the scripts always run what the source says. */
export function buildApp(): void {
  const r = spawnSync('npm', ['run', 'build', '-w', '@galley/desktop'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`The app did not build:\n${r.stdout}\n${r.stderr}`);
}

export interface RunningApp {
  app: ElectronApplication;
  close(): Promise<void>;
}

/** Launch the built app with a `.galley` package as the active package (its images are served to the export window). */
export async function launchGalley(options: { open: string; env?: Record<string, string> }): Promise<RunningApp> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.GALLEY_E2E = '1';
  env.GALLEY_OPEN = options.open;
  Object.assign(env, options.env);
  const electronPath = require('electron') as unknown as string; // the path of the Electron binary
  const app = await electron.launch({ executablePath: electronPath, args: [APP_DIR], cwd: APP_DIR, env });
  // the editor window loads the package, which makes it the active one for galley-asset:// URLs
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"]');
  return { app, close: () => app.close().catch(() => undefined) };
}

export function readPackage(dir: string): DocumentFiles {
  return {
    document: fs.readFileSync(path.join(dir, 'document.json'), 'utf8'),
    links: fs.existsSync(path.join(dir, 'links.json')) ? fs.readFileSync(path.join(dir, 'links.json'), 'utf8') : '{"formatVersion":1,"links":{}}\n',
  };
}

/** What `runToFile` returns (the pipeline result without the PDF bytes). */
export interface ExportRun {
  pageId: string;
  sheet: { width: number; height: number };
  trim: { width: number; height: number };
  profile: { name: string; kind: 'press' | 'fallback'; path: string };
  warnings: string[];
  report: {
    spots: string[];
    boxes: Record<string, number[]>;
    totals: { rgbOps: number; defaultBlack: number; defaultWhite: number; maxRoundingError: number; sentinelHits: Record<string, number> };
    unmatched: string[];
    unhandled: string[];
    skippedImages: string[];
    shadings: { unsupported: string[] };
    pageSizeDeltaPt: { w: number; h: number };
  };
}

export async function exportToFile(
  running: RunningApp,
  request: { files: DocumentFiles; options: { bleed: boolean; marks: boolean }; title?: string; photoMode?: 'cmyk' | 'rgb-icc' },
  pdfPath: string,
  chromiumPdfPath?: string,
): Promise<ExportRun> {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  return running.app.evaluate(
    async (_electron, args) => {
      const hook = (globalThis as unknown as { __galleyExport: { runToFile(r: unknown, p: string, c?: string): Promise<unknown> } }).__galleyExport;
      return hook.runToFile(args.request, args.pdfPath, args.chromiumPdfPath);
    },
    { request, pdfPath, chromiumPdfPath },
  ) as Promise<ExportRun>;
}
