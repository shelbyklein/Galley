// The open package: where its images live, and the `galley-asset://` protocol that serves them to windows.
// Owned by lane C (lane F wrote the first version).
//
// One document per app. The "active package" is the folder whose images `galley-asset://pkg/<relative path>` serves:
//   - an opened or saved document: its `X.galley` folder
//   - a new, never-saved document: a scratch package in the OS temp folder, created the first time something needs a
//     place for an image (`ensureActivePackage()`); Save As copies its images into the real package
// Other main-process code (lane B's place-image handler, lane A's export) uses `getActivePackage()` /
// `ensureActivePackage()` / `getMissingLinks()` from here.
import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME } from '../shared/assets';
import type { MissingLink, PackageFiles } from '../shared/ipc';
import { readPackageFiles } from './packageIO';

export { readPackageFiles as readPackage };

let activePackageDir: string | null = null;
let scratchPackage = false;
let missingLinks: MissingLink[] = [];

/** The folder `galley-asset://pkg/...` serves, or null for an untitled document that has no images yet. */
export function getActivePackage(): string | null {
  return activePackageDir;
}

/** The active package folder, creating a scratch package (with an `assets/` folder) for an untitled document. */
export function ensureActivePackage(): string {
  if (!activePackageDir) {
    activePackageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-untitled-'));
    fs.mkdirSync(path.join(activePackageDir, 'assets'), { recursive: true });
    scratchPackage = true;
  }
  return activePackageDir;
}

/** Make `dir` the active package (a document was opened or saved there). A scratch package it replaces is deleted. */
export function setActivePackage(dir: string | null): void {
  const previous = activePackageDir;
  const wasScratch = scratchPackage;
  activePackageDir = dir ? path.resolve(dir) : null;
  scratchPackage = false;
  if (wasScratch && previous && previous !== activePackageDir) removeScratch(previous);
}

/** True while the active package is the temp folder of a never-saved document. */
export function isScratchPackage(): boolean {
  return scratchPackage;
}

/** Delete the scratch package, if any (app quit, or before a new document). */
export function discardScratchPackage(): void {
  if (scratchPackage && activePackageDir) removeScratch(activePackageDir);
  if (scratchPackage) activePackageDir = null;
  scratchPackage = false;
}

function removeScratch(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp folder: the OS cleans it up eventually */
  }
}

/** The image links of the open document whose files are not in its package. Lane A's export refuses to print while any are missing. */
export function getMissingLinks(): MissingLink[] {
  return missingLinks;
}
export function setMissingLinks(links: MissingLink[]): void {
  missingLinks = links;
}

/**
 * The package to open at startup: `--open <path>`, else $GALLEY_OPEN (the e2e hook), else (only under `npm run dev`,
 * i.e. when electron-vite's dev server is running) the repository's poster fixture. Null means start with a blank document.
 */
export function initialPackagePath(): string | null {
  const flag = process.argv.indexOf('--open');
  const fromArgs = flag >= 0 ? process.argv[flag + 1] : undefined;
  const explicit = fromArgs ?? process.env.GALLEY_OPEN;
  if (explicit) return path.resolve(explicit);
  if (process.env.ELECTRON_RENDERER_URL) return path.resolve(app.getAppPath(), '../../fixtures/poster-basic.galley');
  return null;
}

export type { PackageFiles };

/** Must run before the app is ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/**
 * What a window sees where an image link is broken: pale hatching with a red mark and "Missing link", drawn to fill
 * whatever box the image is placed in. (The root `<svg>` scales its 200 x 120 artwork uniformly and centers it; the
 * huge hatched rectangle covers the rest, so the placeholder never looks stretched.)
 */
export const MISSING_LINK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">
<defs><pattern id="h" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#f6dedc"/><rect width="5" height="10" fill="#efc9c6"/></pattern></defs>
<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#h)"/>
<circle cx="100" cy="48" r="22" fill="#e5352b"/>
<rect x="97" y="34" width="6" height="18" rx="2" fill="#fff"/><circle cx="100" cy="60" r="3.4" fill="#fff"/>
<text x="100" y="94" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="#8a2a24">Missing link</text>
</svg>`;

/** Serve `galley-asset://pkg/<relative path>` from the active package. Run after the app is ready. */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const root = activePackageDir;
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const placeholder = () =>
      new Response(MISSING_LINK_SVG, { status: 200, headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', 'x-galley-missing-link': '1' } });
    if (!root) return placeholder();
    const file = path.resolve(root, relative);
    // never serve anything outside the package folder
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file)) return placeholder();
    return net.fetch(pathToFileURL(file).toString());
  });
}
