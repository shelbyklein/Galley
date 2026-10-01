import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readImageInfo } from './image-info';
import { linkImage, safeAssetName } from './link';

const base = () => sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 60, b: 20 } } });

describe('readImageInfo', () => {
  it('reads a PNG: size, resolution, color space', async () => {
    const png = await base().withMetadata({ density: 300 }).png().toBuffer();
    expect(readImageInfo(png)).toEqual({ width: 120, height: 80, ppi: 300, colorSpace: 'rgb', format: 'png' });
  });

  it('uses 72 ppi when a PNG records none', async () => {
    const png = await base().png().toBuffer();
    // sharp writes a pHYs of 72 dpi by default; strip it by cutting the chunk out to test the fallback
    const at = png.indexOf('pHYs');
    const without = at > 0 ? Buffer.concat([png.subarray(0, at - 4), png.subarray(at - 4 + 4 + 4 + 9 + 4)]) : png;
    expect(readImageInfo(without)?.ppi).toBe(72);
  });

  it('reads a grayscale PNG', async () => {
    const png = await base().toColourspace('b-w').png().toBuffer();
    expect(readImageInfo(png)?.colorSpace).toBe('gray');
  });

  it('reads a JPEG: JFIF density in dots per inch', async () => {
    const jpg = await base().withMetadata({ density: 150 }).jpeg().toBuffer();
    expect(readImageInfo(jpg)).toEqual({ width: 120, height: 80, ppi: 150, colorSpace: 'rgb', format: 'jpeg' });
  });

  it('reads a CMYK JPEG', async () => {
    const jpg = await base().toColourspace('cmyk').jpeg().toBuffer();
    expect(readImageInfo(jpg)?.colorSpace).toBe('cmyk');
  });

  it('rejects anything else', () => {
    expect(readImageInfo(Buffer.from('GIF89a......'))).toBeNull();
    expect(readImageInfo(Buffer.alloc(0))).toBeNull();
    expect(readImageInfo(Buffer.from('not an image at all, just text'))).toBeNull();
  });
});

describe('linkImage', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'galley-link-'));

  it('copies the file into assets/ and returns a relative path, hash and metadata', async () => {
    const pkg = tmp();
    const src = path.join(tmp(), 'My Photo (1).png');
    fs.writeFileSync(src, await base().withMetadata({ density: 200 }).png().toBuffer());
    const placed = linkImage(pkg, src);
    expect(placed).toMatchObject({ path: 'assets/My Photo (1).png', width: 120, height: 80, ppi: 200, colorSpace: 'rgb' });
    expect(placed.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(pkg, placed.path)).equals(fs.readFileSync(src))).toBe(true);
  });

  it('reuses an identical file and renames a different one with the same name', async () => {
    const pkg = tmp();
    const dir = tmp();
    const a = path.join(dir, 'a.png');
    fs.writeFileSync(a, await base().png().toBuffer());
    const first = linkImage(pkg, a);
    expect(linkImage(pkg, a).path).toBe(first.path);
    fs.writeFileSync(a, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00f' } }).png().toBuffer());
    const second = linkImage(pkg, a);
    expect(second.path).toBe('assets/a-2.png');
    expect(second.hash).not.toBe(first.hash);
  });

  it('refuses a file that is not a PNG or JPEG', () => {
    const src = path.join(tmp(), 'notes.txt');
    fs.writeFileSync(src, 'hello');
    expect(() => linkImage(tmp(), src)).toThrow(/not a PNG or JPEG/);
  });

  it('makes names safe for a package path', () => {
    expect(safeAssetName('a/b\\c:d*.png')).toBe('a_b_c_d_.png');
    expect(safeAssetName('..hidden.png')).toBe('_hidden.png');
    expect(safeAssetName('')).toBe('image');
  });
});
