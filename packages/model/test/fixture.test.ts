import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSentinelTable, parseDocument, serializeDocument, validateDocument } from '../src';
import { buildPosterBasic, POSTER_ENGINE_VERSION } from '../../../scripts/fixtures/poster-basic';

const dir = fileURLToPath(new URL('../../../fixtures/poster-basic.galley/', import.meta.url));
const read = (f: string) => fs.readFileSync(dir + f, 'utf8');

describe('fixtures/poster-basic.galley', () => {
  const doc = parseDocument({ document: read('document.json'), links: read('links.json') });

  it('parses and validates', () => {
    expect(validateDocument(doc)).toEqual([]);
    expect(doc.meta).toEqual({ title: 'Spring Poster', engineVersion: '44.5.1', colorProfile: null });
  });

  it('is a Tabloid page with bleed, slug and 3 columns, like the mockup status bar', () => {
    const page = doc.pages[doc.pageOrder[0]!]!;
    expect([page.width, page.height]).toEqual([792, 1224]);
    expect(page.bleed).toEqual({ top: 9, right: 9, bottom: 9, left: 9 });
    expect(page.columns.count).toBe(3);
  });

  it('has the poster\'s content: orange block, CMYK headline, 100K body text, a spot ellipse and a photo', () => {
    expect(doc.frames['orange-block']).toMatchObject({ type: 'rect', x: -9, y: -9, fill: { swatchId: 'warm-orange' } });
    expect(doc.stories.story_spring!.defaults.fill.swatchId).toBe('studio-blue');
    expect(doc.swatches['studio-blue']).toMatchObject({ type: 'cmyk', values: [100, 80, 0, 20] });
    expect(doc.stories.story_body!.defaults.fill.swatchId).toBe('black');
    expect(doc.swatches.black).toMatchObject({ values: [0, 0, 0, 100] });
    expect(doc.frames['free-ellipse']).toMatchObject({ type: 'ellipse', fill: { swatchId: 'pms-185-c' } });
    expect(doc.swatches['pms-185-c']).toMatchObject({ type: 'spot', name: 'PANTONE 185 C' });
    expect(doc.frames['photo-frame']).toMatchObject({ type: 'image', x: 36, y: 516, w: 720, h: 384, assetId: 'photo' });
  });

  it('links a photo whose bytes match the recorded hash and pixel size', () => {
    const asset = doc.assets.photo!;
    const bytes = fs.readFileSync(dir + asset.path);
    expect(asset.hash).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    // JPEG SOF0/SOF2 marker holds the pixel size
    let i = 2;
    let size: [number, number] | null = null;
    while (i < bytes.length) {
      const marker = bytes[i + 1]!;
      const len = bytes.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + len;
    }
    expect(size).toEqual([asset.width, asset.height]);
    expect(bytes.length).toBeLessThan(400 * 1024);
  });

  it('uses 6 distinct inks, including a spot, K-only black and Paper', () => {
    const table = buildSentinelTable(doc);
    expect(table.map((e) => e.key)).toEqual(['black|100|ko', 'paper|100|ko', 'pms-185-c|100|ko', 'studio-blue|100|ko', 'warm-orange|100|ko']);
    expect(table.find((e) => e.swatchId === 'pms-185-c')).toMatchObject({ model: 'spot', name: 'PANTONE 185 C' });
  });

  it('matches what the builder produces (run `npm run fixtures` after changing scripts/fixtures)', () => {
    const asset = doc.assets.photo!;
    const rebuilt = buildPosterBasic({ path: asset.path, hash: asset.hash, width: asset.width, height: asset.height });
    const files = serializeDocument(rebuilt, { engineVersion: POSTER_ENGINE_VERSION });
    expect(files.document).toBe(read('document.json'));
    expect(files.links).toBe(read('links.json'));
  });
});
