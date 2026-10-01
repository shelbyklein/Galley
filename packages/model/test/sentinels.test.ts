import { describe, expect, it } from 'vitest';
import {
  addFrame,
  buildSentinelTable,
  collectPaints,
  createStory,
  isSentinelCss,
  lookupSentinel,
  paint,
  paintKey,
  resolveInk,
  SENTINEL_BASE,
  SENTINEL_CAPACITY,
  SENTINEL_STEP,
  sentinelCss,
  sentinelFor,
  sentinelsByKey,
  type GalleyDocument,
} from '../src';
import { baseDoc, history, rectFrame, run } from './helpers';

function poster(): GalleyDocument {
  let h = history();
  h = run(h, addFrame, { frame: rectFrame('bg', { fill: paint('orange') }), pageId: 'page_1' });
  h = run(h, addFrame, { frame: rectFrame('spot', { fill: paint('spot185'), stroke: { paint: paint('black', 100, true), weight: 1 } }), pageId: 'page_1' });
  h = run(h, addFrame, { frame: rectFrame('tinted', { fill: paint('spot185', 40) }), pageId: 'page_1' });
  h = run(h, addFrame, { frame: rectFrame('named-tint', { fill: paint('spot185-40') }), pageId: 'page_1' });
  h = run(h, addFrame, {
    frame: { id: 'txt', type: 'text', name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId: 'sty', inset: 0 },
    pageId: 'page_1',
    story: createStory('sty', 'Body', { fill: paint('black') }),
  });
  return h.doc;
}

describe('sentinelFor (ported from spikes/press/src/sentinel.cjs)', () => {
  it('matches the spike: digits of i in base 16, each BASE + STEP * digit', () => {
    expect(SENTINEL_STEP).toBe(15);
    expect(SENTINEL_BASE).toBe(10);
    expect(sentinelFor(0)).toEqual([10, 10, 10]);
    expect(sentinelFor(1)).toEqual([10, 10, 25]);
    expect(sentinelFor(16)).toEqual([10, 25, 10]);
    expect(sentinelFor(256)).toEqual([25, 10, 10]);
    expect(sentinelFor(4095)).toEqual([235, 235, 235]);
  });

  it('is unique for every index, stays clear of pure black and white, and keeps channels at least STEP apart', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SENTINEL_CAPACITY; i++) {
      const rgb = sentinelFor(i);
      seen.add(rgb.join(','));
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(10);
        expect(c).toBeLessThanOrEqual(235);
        expect((c - SENTINEL_BASE) % SENTINEL_STEP).toBe(0);
      }
    }
    expect(seen.size).toBe(SENTINEL_CAPACITY);
  });

  it('rejects an index outside the capacity', () => {
    expect(() => sentinelFor(-1)).toThrow(RangeError);
    expect(() => sentinelFor(SENTINEL_CAPACITY)).toThrow(RangeError);
  });
});

describe('buildSentinelTable', () => {
  it('has one entry per distinct ink in use, sorted by key (plain string order, so "100" sorts before "40")', () => {
    const table = buildSentinelTable(poster());
    expect(table.map((e) => e.key)).toEqual(['black|100|ko', 'black|100|op', 'orange|100|ko', 'spot185|100|ko', 'spot185|40|ko']);
    expect(table.map((e) => e.rgb)).toEqual([0, 1, 2, 3, 4].map(sentinelFor));
  });

  it('merges a tint swatch with the same swatch applied at that tint, but keeps overprint separate', () => {
    const doc = poster();
    expect(paintKey(doc, paint('spot185-40'))).toBe(paintKey(doc, paint('spot185', 40)));
    expect(paintKey(doc, paint('black', 100, true))).not.toBe(paintKey(doc, paint('black')));
    expect(paintKey(doc, paint('spot185-40', 50))).toBe('spot185|20|ko'); // tints multiply
  });

  it('resolves spot inks to the separation name and CMYK alternate, and tint swatches to their base', () => {
    const doc = poster();
    expect(resolveInk(doc, paint('spot185-40'))).toEqual({ swatchId: 'spot185', name: 'PANTONE 185 C', model: 'spot', values: [0, 91, 76, 0], tint: 40, overprint: false });
    expect(resolveInk(doc, paint('orange'))).toMatchObject({ model: 'cmyk', values: [0, 60, 100, 0], tint: 100 });
  });

  it('is deterministic: the same document always gives the same table, whatever the object order', () => {
    const a = poster();
    const b = JSON.parse(JSON.stringify(a)) as GalleyDocument;
    b.frames = Object.fromEntries(Object.entries(b.frames).reverse());
    expect(buildSentinelTable(b)).toEqual(buildSentinelTable(a));
    expect(buildSentinelTable(a)).toEqual(buildSentinelTable(a));
  });

  it('includes story default colors and ignores unused swatches', () => {
    const doc = poster();
    expect(collectPaints(doc).length).toBe(6);
    expect(buildSentinelTable(baseDoc())).toEqual([]);
  });

  it('keys depend only on swatch ids, so editing a swatch value never reassigns a sentinel', () => {
    const doc = poster();
    const before = buildSentinelTable(doc).map((e) => [e.key, e.rgb]);
    const edited = JSON.parse(JSON.stringify(doc)) as GalleyDocument;
    edited.swatches.orange = { id: 'orange', name: 'Orange', type: 'cmyk', values: [10, 70, 90, 5] };
    expect(buildSentinelTable(edited).map((e) => [e.key, e.rgb])).toEqual(before);
  });

  it('throws past the 4096-ink capacity', () => {
    const doc = JSON.parse(JSON.stringify(baseDoc())) as GalleyDocument;
    for (let i = 0; i <= SENTINEL_CAPACITY; i++) {
      const id = `sw${i}`;
      doc.swatches[id] = { id, name: `S${i}`, type: 'cmyk', values: [0, 0, 0, 0] };
      doc.swatchOrder.push(id);
      doc.frames[`f${i}`] = rectFrame(`f${i}`, { fill: paint(id) });
      doc.pages.page_1!.items.push(`f${i}`);
    }
    expect(() => buildSentinelTable(doc)).toThrow(RangeError);
  });
});

describe('lookup', () => {
  it('maps content-stream floats back to the entry, rounding each channel to 1/255', () => {
    const table = buildSentinelTable(poster());
    const e = table[2]!;
    expect(lookupSentinel(table, e.rgb[0] / 255, e.rgb[1] / 255, e.rgb[2] / 255)).toBe(e);
    // Skia writes 4 decimals; the spike measured a worst case of 0.0125 of a level
    expect(lookupSentinel(table, e.rgb[0] / 255 + 0.00004, e.rgb[1] / 255 - 0.00004, e.rgb[2] / 255)).toBe(e);
    expect(lookupSentinel(table, 0, 0, 0)).toBeNull();
    expect(lookupSentinel(table, 1, 1, 1)).toBeNull();
  });

  it('formats and recognizes sentinel CSS colors', () => {
    const table = buildSentinelTable(poster());
    const css = sentinelCss(table[0]!);
    expect(css).toBe('rgb(10 10 10)');
    expect(isSentinelCss(table, css)).toBe(true);
    expect(isSentinelCss(table, 'rgb(10, 10, 10)')).toBe(true);
    expect(isSentinelCss(table, 'rgb(0 0 0)')).toBe(false);
    expect(isSentinelCss(table, '#0a0a0a')).toBe(false);
    expect(sentinelsByKey(table).get('orange|100|ko')).toBe(table[2]);
  });
});
