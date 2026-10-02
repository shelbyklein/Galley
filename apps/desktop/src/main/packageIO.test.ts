import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocument, parseDocument, serializeDocument } from '@galley/model';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureGalleyExtension,
  findMissingLinks,
  isSafeRelativePath,
  packageName,
  PackageError,
  readPackageFiles,
  resolvePackageDir,
  writePackage,
} from './packageIO';
import { RecentFiles } from './recents';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-io-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const HASH = `sha256:${'a'.repeat(64)}`;
function docWithImage() {
  const doc = createDocument({ title: 'Test', engineVersion: '44.5.1' });
  doc.assets.photo = { id: 'photo', kind: 'image', width: 10, height: 10, ppi: 72, colorSpace: 'rgb', path: 'assets/photo.jpg', hash: HASH };
  return doc;
}

describe('package paths', () => {
  it('names a package after its folder', () => {
    expect(packageName('/x/Spring Poster.galley')).toBe('Spring Poster');
    expect(packageName('/x/Plain')).toBe('Plain');
    expect(ensureGalleyExtension('/x/Poster')).toBe('/x/Poster.galley');
    expect(ensureGalleyExtension('/x/Poster.GALLEY')).toBe('/x/Poster.GALLEY');
  });

  it('accepts only relative paths inside the package', () => {
    for (const ok of ['assets/photo.jpg', 'a/b/c.png']) expect(isSafeRelativePath(ok)).toBe(true);
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'C:\\x', 'a\\b']) expect(isSafeRelativePath(bad)).toBe(false);
  });

  it('resolves a document.json inside a package to the package folder', () => {
    const dir = path.join(tmp, 'A.galley');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'document.json'), '{}');
    expect(resolvePackageDir(path.join(dir, 'document.json'))).toBe(dir);
    expect(resolvePackageDir(dir)).toBe(dir);
  });
});

describe('writing and reading a package', () => {
  it('writes document.json, links.json and an assets folder, and reads them back to the same document', () => {
    const doc = docWithImage();
    const files = serializeDocument(doc);
    const target = path.join(tmp, 'Out.galley');
    writePackage(target, files, { sourceDir: null, assetPaths: [] });
    expect(fs.existsSync(path.join(target, 'document.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'links.json'))).toBe(true);
    expect(fs.statSync(path.join(target, 'assets')).isDirectory()).toBe(true);
    const back = readPackageFiles(target);
    expect(parseDocument(back)).toEqual(doc);
    expect(fs.readdirSync(target).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('saving to a new place copies the linked images and fonts; a missing image stays missing', () => {
    const source = path.join(tmp, 'Old.galley');
    fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(source, 'fonts'));
    fs.writeFileSync(path.join(source, 'assets', 'photo.jpg'), 'JPEG');
    fs.writeFileSync(path.join(source, 'fonts', 'f.ttf'), 'FONT');
    const target = path.join(tmp, 'New.galley');
    writePackage(target, serializeDocument(docWithImage()), { sourceDir: source, assetPaths: ['assets/photo.jpg', 'assets/gone.jpg', '../escape.jpg'] });
    expect(fs.readFileSync(path.join(target, 'assets', 'photo.jpg'), 'utf8')).toBe('JPEG');
    expect(fs.readFileSync(path.join(target, 'fonts', 'f.ttf'), 'utf8')).toBe('FONT');
    expect(fs.existsSync(path.join(target, 'assets', 'gone.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'escape.jpg'))).toBe(false);
  });

  it('saving in place copies nothing and replaces the documents', () => {
    const dir = path.join(tmp, 'Same.galley');
    writePackage(dir, serializeDocument(docWithImage()), { sourceDir: null, assetPaths: [] });
    fs.writeFileSync(path.join(dir, 'assets', 'photo.jpg'), 'JPEG');
    const changed = docWithImage();
    changed.meta.title = 'Changed';
    writePackage(dir, serializeDocument(changed), { sourceDir: dir, assetPaths: ['assets/photo.jpg'] });
    expect(parseDocument(readPackageFiles(dir)).meta.title).toBe('Changed');
    expect(fs.readFileSync(path.join(dir, 'assets', 'photo.jpg'), 'utf8')).toBe('JPEG');
  });

  it('refuses a folder that is not a package, with a readable message', () => {
    const empty = path.join(tmp, 'Empty.galley');
    fs.mkdirSync(empty);
    expect(() => readPackageFiles(empty)).toThrow(PackageError);
    expect(() => readPackageFiles(empty)).toThrow(/no document\.json/);
    expect(() => readPackageFiles(path.join(tmp, 'nope'))).toThrow(/not a Galley document folder/);
  });
});

describe('missing links', () => {
  it('lists the links whose files are gone', () => {
    const dir = path.join(tmp, 'Links.galley');
    const files = serializeDocument(docWithImage());
    writePackage(dir, files, { sourceDir: null, assetPaths: [] });
    expect(findMissingLinks(dir, files.links)).toEqual([{ assetId: 'photo', path: 'assets/photo.jpg' }]);
    fs.writeFileSync(path.join(dir, 'assets', 'photo.jpg'), 'x');
    expect(findMissingLinks(dir, files.links)).toEqual([]);
    fs.renameSync(path.join(dir, 'assets', 'photo.jpg'), path.join(dir, 'assets', 'renamed.jpg'));
    expect(findMissingLinks(dir, files.links)).toHaveLength(1);
  });

  it('treats an unsafe path as missing, and tolerates no links.json or a broken one', () => {
    const dir = path.join(tmp, 'X.galley');
    fs.mkdirSync(dir);
    const unsafe = JSON.stringify({ formatVersion: 1, links: { evil: { path: '../outside.jpg', hash: HASH } } });
    expect(findMissingLinks(dir, unsafe)).toEqual([{ assetId: 'evil', path: '../outside.jpg' }]);
    expect(findMissingLinks(dir, undefined)).toEqual([]);
    expect(findMissingLinks(dir, '{not json')).toEqual([]);
  });
});

describe('recent files', () => {
  const makePackage = (name: string) => {
    const dir = path.join(tmp, `${name}.galley`);
    writePackage(dir, serializeDocument(createDocument({ engineVersion: 'x' })), { sourceDir: null, assetPaths: [] });
    return dir;
  };

  it('keeps the newest first, without duplicates, up to the limit', () => {
    const recents = new RecentFiles(path.join(tmp, 'profile', 'recent.json'), 3);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(makePackage) as [string, string, string, string];
    recents.add(a);
    recents.add(b);
    recents.add(c);
    expect(recents.list().map((r) => r.name)).toEqual(['C', 'B', 'A']);
    recents.add(a);
    expect(recents.list().map((r) => r.name)).toEqual(['A', 'C', 'B']);
    recents.add(d);
    expect(recents.list().map((r) => r.name)).toEqual(['D', 'A', 'C']);
  });

  it('forgets packages that no longer exist, and can be cleared', () => {
    const recents = new RecentFiles(path.join(tmp, 'recent.json'));
    const a = makePackage('A');
    const b = makePackage('B');
    recents.add(a);
    recents.add(b);
    fs.rmSync(a, { recursive: true });
    expect(recents.list().map((r) => r.name)).toEqual(['B']);
    expect(recents.clear()).toEqual([]);
    expect(recents.list()).toEqual([]);
  });

  it('starts empty when the file is missing or damaged', () => {
    const file = path.join(tmp, 'recent.json');
    expect(new RecentFiles(file).list()).toEqual([]);
    fs.writeFileSync(file, 'garbage');
    expect(new RecentFiles(file).list()).toEqual([]);
  });
});
