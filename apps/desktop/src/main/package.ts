// Reading `.galley` packages and serving their images. Owned by lane C (real file handling replaces the temporary
// startup-open logic here); lane F wrote the minimum the editor and the export window need.
import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME } from '../shared/assets';
import type { PackageFiles } from '../shared/ipc';

/** The package folder whose images `galley-asset://pkg/...` serves. One document per app for now. */
let activePackageDir: string | null = null;

export function setActivePackage(dir: string): void {
  activePackageDir = dir;
}

export function getActivePackage(): string | null {
  return activePackageDir;
}

export function readPackage(dir: string): PackageFiles {
  const document = fs.readFileSync(path.join(dir, 'document.json'), 'utf8');
  const linksPath = path.join(dir, 'links.json');
  return { document, links: fs.existsSync(linksPath) ? fs.readFileSync(linksPath, 'utf8') : undefined };
}

/**
 * TEMPORARY. The package to open at startup: `--open <path>`, else $GALLEY_OPEN, else (only under `npm run dev`, i.e.
 * when electron-vite's dev server is running) the repository's poster fixture. Null means start with a blank document.
 */
export function initialPackagePath(): string | null {
  const flag = process.argv.indexOf('--open');
  const fromArgs = flag >= 0 ? process.argv[flag + 1] : undefined;
  const explicit = fromArgs ?? process.env.GALLEY_OPEN;
  if (explicit) return path.resolve(explicit);
  if (process.env.ELECTRON_RENDERER_URL) return path.resolve(app.getAppPath(), '../../fixtures/poster-basic.galley');
  return null;
}

/** Must run before the app is ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Serve `galley-asset://pkg/<relative path>` from the active package. Run after the app is ready. */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const root = activePackageDir;
    if (!root) return new Response('No document is open', { status: 404 });
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    // never serve anything outside the package folder
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
