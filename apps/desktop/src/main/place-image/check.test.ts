import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { inspectLinks } from './check';
import { linkImage } from './link';

describe('explicit packaged link inspection', () => {
  it('hashes bytes, distinguishes missing and changed, and relinks without overwriting older bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-links-unit-'));
    const source = path.join(root, 'original.png');
    const first = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#f00' } }).png().toBuffer();
    fs.writeFileSync(source, first);
    const original = { id: 'asset1', kind: 'image' as const, ...linkImage(root, source) };
    expect(inspectLinks(root, [original])[0]?.status).toBe('ok');
    fs.writeFileSync(source, await sharp({ create: { width: 80, height: 120, channels: 3, background: '#00f' } }).png().toBuffer());
    const replacement = linkImage(root, source);
    expect(replacement.path).not.toBe(original.path);
    expect(fs.readFileSync(path.join(root, original.path))).toEqual(first);
    fs.writeFileSync(path.join(root, original.path), fs.readFileSync(source));
    expect(inspectLinks(root, [original])[0]?.status).toBe('changed');
    fs.unlinkSync(path.join(root, original.path));
    expect(inspectLinks(root, [original])[0]?.status).toBe('missing');
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('rejects invalid IPC assets before reading any files and refuses escaping symlinks', () => {
    expect(() => inspectLinks(null, [{ id: 'x', path: '../../outside' }])).toThrow();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-links-safe-'));
    fs.symlinkSync('/etc/hosts', path.join(root, 'escape'));
    expect(inspectLinks(root, [{ id: 'asset1', kind: 'image', path: 'escape', hash: `sha256:${'0'.repeat(64)}`, width: 1, height: 1, ppi: 72, colorSpace: 'rgb' }])[0]?.status).toBe('unreadable');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
