import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import { describe, expect, test } from 'vitest';
import { embeddingPermission, groupFontFamilies, resolveFontFace, scanFontFolders } from '../src';
import { findFontFace } from '../src/match';
import { instanceFont } from '../src/instance';
const require = createRequire(import.meta.url);
const woff2 = require('wawoff2') as { decompress(bytes: Uint8Array): Promise<Uint8Array> };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-font-unit-'));
const inter = path.dirname(require.resolve('@fontsource/inter/package.json'));
const roboto = path.dirname(require.resolve('@fontsource-variable/roboto/package.json'));
async function fixtures() {
  fs.writeFileSync(path.join(temp, 'Inter-Regular.ttf'), Buffer.from(await woff2.decompress(fs.readFileSync(path.join(inter, 'files/inter-latin-400-normal.woff2')))));
  fs.writeFileSync(path.join(temp, 'Roboto-Variable.ttf'), Buffer.from(await woff2.decompress(fs.readFileSync(path.join(roboto, 'files/roboto-latin-wght-normal.woff2')))));
  fs.writeFileSync(path.join(temp, 'damaged.ttf'), 'not a font');
  return scanFontFolders([{ path: temp, source: 'document' }]);
}

describe('font inventory and export instances', () => {
  test('scans OFL static/variable fixtures, metadata and cached results', async () => {
    const faces = await fixtures();
    expect(new Set(faces.map((f) => f.family)).size).toBe(2);
    expect(faces.filter((f) => f.family === 'Roboto').map((f) => f.weight).sort((a, b) => a - b)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    const regular = faces.find((f) => f.family === 'Inter')!;
    expect(regular).toMatchObject({ family: 'Inter', styleName: 'Regular', weight: 400, style: 'normal', format: 'truetype', fsType: 0, embeddable: true, axes: {}, source: 'document' });
    const variable = faces.find((f) => f.family === 'Roboto')!;
    expect(variable.format).toBe('variable');
    expect(variable.axes.wght).toMatchObject({ min: 100, default: 400, max: 900 });
    const cache = path.join(temp, 'cache.json');
    expect(scanFontFolders([{ path: temp, source: 'document' }], cache)).toEqual(faces);
    expect(scanFontFolders([{ path: temp, source: 'document' }], cache)).toEqual(faces);
  });

  test('document faces take priority and unavailable styles get an explicit fallback', async () => {
    const faces = await fixtures();
    const regular = faces.find((f) => f.family === 'Inter')!;
    const families = groupFontFamilies([{ ...regular, source: 'system', path: '/system/font.ttf' }, regular, { ...regular, source: 'bundled' }]);
    expect(resolveFontFace(families, { family: 'Inter', weight: 400, style: 'normal' }).face.source).toBe('document');
    expect(resolveFontFace(families, { family: 'Absent', weight: 400, style: 'normal' })).toMatchObject({ missing: true, face: { family: 'Inter' } });
    expect(resolveFontFace(families, { family: 'Inter', weight: 400, style: 'italic' }).missing).toBe(true);
  });

  test('pre-export warnings use the same document-priority face as export, even before lower-weight variable styles', async () => {
    const faces = await fixtures();
    const regular = faces.find((f) => f.family === 'Inter')!;
    const variable = faces.find((f) => f.family === 'Roboto' && f.weight === 100)!;
    const families = groupFontFamilies([{ ...variable, family: 'Inter', source: 'system' }, { ...regular, fsType: 2, ...embeddingPermission(2) }]);
    expect(findFontFace(families, { family: 'Inter', weight: 400, style: 'normal' })).toMatchObject({ source: 'document', embeddable: false });
  });

  test('embedding permission permits preview-and-print; refuses forbidden outlines or subsetting', () => {
    for (const fsType of [0, 4, 8]) expect(embeddingPermission(fsType).embeddable).toBe(true);
    for (const fsType of [2, 0x100, 0x200, 0x104]) expect(embeddingPermission(fsType).embeddable).toBe(false);
  });

  test('legacy bundled weights use CSS nearest-face rules without replacing exact document styles', async () => {
    const regular = (await fixtures()).find(f => f.family === 'Inter')!;
    const bundled = [400, 700].map(weight => ({ ...regular, source: 'bundled' as const, style: 'italic' as const, weight }));
    const request = { family: 'Inter', weight: 900, style: 'italic' as const };
    expect(resolveFontFace(groupFontFamilies(bundled), request)).toMatchObject({ missing: false, face: { source: 'bundled', weight: 700 } });
    const authored = { ...regular, style: 'italic' as const, weight: 900 };
    expect(findFontFace(groupFontFamilies([...bundled, authored]), request)).toMatchObject({ source: 'document', weight: 900 });
    expect(findFontFace(groupFontFamilies([{ ...regular, style: 'italic', weight: 700 }]), request)).toBeUndefined();
    // CSS searches heavier faces first above 500, lighter faces first below 400, and 400–500 specially.
    const weights = [300, 400, 500, 700].map(weight => ({ ...regular, source: 'bundled' as const, weight }));
    for (const [requested, chosen] of [[350, 300], [450, 500], [600, 700]]) {
      expect(findFontFace(groupFontFamilies(weights), { family: 'Inter', weight: requested!, style: 'normal' })?.weight).toBe(chosen);
    }
  });

  test('HarfBuzz WASM pins all axes and keeps glyph advances and shaping', async () => {
    const face = (await fixtures()).find((f) => f.family === 'Roboto')!;
    const bytes = await instanceFont(face, { family: 'Roboto', weight: 650, style: 'normal' });
    const instance = fontkit.create(bytes) as fontkit.Font;
    expect(instance.variationAxes).toEqual({});
    const original = fontkit.openSync(face.path) as fontkit.Font;
    const variable = original.getVariation({ wght: 650 });
    const specimen = 'office affinity Hamburg 0123456789';
    const before = variable.layout(specimen), after = instance.layout(specimen);
    expect(after.glyphs.map((g) => g.id)).toEqual(before.glyphs.map((g) => g.id));
    // Static SFNT advances are integral design units; HarfBuzz rounds interpolated advances.
    after.positions.forEach((position, i) => expect(Math.abs(position.xAdvance - before.positions[i]!.xAdvance)).toBeLessThanOrEqual(0.501));
    await expect(instanceFont({ ...face, ...embeddingPermission(2), fsType: 2 }, { family: 'Roboto', weight: 650, style: 'normal' })).rejects.toThrow('Restricted');
  });
});
