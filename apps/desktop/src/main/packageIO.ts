// Reading and writing `.galley` folder packages. Pure file-system code (no Electron), so it is unit-tested directly.
// Owned by lane C.
//
//   X.galley/
//     document.json   the model (sorted-key canonical JSON, written by @galley/model)
//     links.json      asset id -> relative path + hash
//     assets/         the linked images
//     fonts/          document fonts (Phase 2); copied along by Save As
import fs from 'node:fs';
import path from 'node:path';
import type { MissingLink, PackageFiles } from '../shared/ipc';

export const PACKAGE_EXTENSION = '.galley';

/** A problem the user can read: not a package, unreadable files, an invalid path. */
export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

/** The display name of a package: its folder name without `.galley`. */
export function packageName(packagePath: string): string {
  const base = path.basename(packagePath);
  return base.toLowerCase().endsWith(PACKAGE_EXTENSION) ? base.slice(0, -PACKAGE_EXTENSION.length) : base;
}

export function ensureGalleyExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(PACKAGE_EXTENSION) ? filePath : filePath + PACKAGE_EXTENSION;
}

/** The package folder for something the user picked: a package folder itself, or a file inside one (`document.json`). */
export function resolvePackageDir(picked: string): string {
  const abs = path.resolve(picked);
  const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;
  if (stat?.isFile()) return path.dirname(abs);
  return abs;
}

/** A path inside the package: relative, no `..`, not absolute. Matches the model's `relativePathSchema` closely enough to be safe. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.');
}

export function readPackageFiles(dir: string): PackageFiles {
  const documentPath = path.join(dir, 'document.json');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new PackageError(`"${path.basename(dir)}" is not a Galley document folder.`);
  if (!fs.existsSync(documentPath)) throw new PackageError(`"${path.basename(dir)}" is not a Galley document: it has no document.json.`);
  const document = fs.readFileSync(documentPath, 'utf8');
  const linksPath = path.join(dir, 'links.json');
  return { document, links: fs.existsSync(linksPath) ? fs.readFileSync(linksPath, 'utf8') : undefined };
}

/** The image links whose files are not in the package. Tolerates a missing or malformed links.json (parsing reports that). */
export function findMissingLinks(dir: string, linksText: string | undefined): MissingLink[] {
  if (!linksText) return [];
  let links: Record<string, { path?: unknown }> = {};
  try {
    const parsed = JSON.parse(linksText) as { links?: Record<string, { path?: unknown }> };
    links = parsed.links ?? {};
  } catch {
    return [];
  }
  const missing: MissingLink[] = [];
  for (const [assetId, link] of Object.entries(links)) {
    const rel = typeof link?.path === 'string' ? link.path : '';
    if (!isSafeRelativePath(rel) || !fs.existsSync(path.join(dir, ...rel.split('/')))) missing.push({ assetId, path: rel });
  }
  return missing;
}

function writeFileAtomic(file: string, text: string): void {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

export interface WriteOptions {
  /** Where the linked images currently live (the open package, or the scratch package of an untitled document). */
  sourceDir: string | null;
  /** The `path` of every linked image. They are copied from `sourceDir` when it is a different folder. */
  assetPaths: readonly string[];
}

/**
 * Write a package: document.json and links.json (atomically), an `assets/` folder, and, when saving to a new place,
 * the linked images and the `fonts/` folder from the old one. Files already in the target stay.
 */
export function writePackage(target: string, files: PackageFiles, options: WriteOptions): void {
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  const source = options.sourceDir ? path.resolve(options.sourceDir) : null;
  if (source && source !== path.resolve(target)) {
    for (const rel of options.assetPaths) {
      if (!isSafeRelativePath(rel)) continue;
      const from = path.join(source, ...rel.split('/'));
      const to = path.join(target, ...rel.split('/'));
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue; // a missing link stays missing
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    const fonts = path.join(source, 'fonts');
    if (fs.existsSync(fonts) && fs.statSync(fonts).isDirectory()) copyDir(fonts, path.join(target, 'fonts'));
  }
  writeFileAtomic(path.join(target, 'links.json'), files.links ?? '{\n  "formatVersion": 2,\n  "links": {}\n}\n');
  writeFileAtomic(path.join(target, 'document.json'), files.document);
}
