import { describe, expect, it } from 'vitest';
import { SentinelTable } from '../src/paint';
import { rewriteContent } from '../src/rewrite';
import { entryByKey, inkDoc, sentinelOperands, tableOf } from './helpers';

const table = tableOf(inkDoc());
const sentinels = new SentinelTable(table);
const SPOTS = ['PANTONE 185 C'];
const rewrite = (src: string) => rewriteContent(src, sentinels, SPOTS, 'test');
const rg = (key: string, op = 'rg') => `${sentinelOperands(entryByKey(table, key))} ${op}`;

describe('sentinel table (built by @galley/model, looked up here)', () => {
  it('has one sentinel per ink, in key order', () => {
    expect(table.map((t) => t.key)).toEqual(['black|100|ko', 'black|100|op', 'orange|100|ko', 'paper|100|ko', 'pms|40|ko']);
    expect(table.map((t) => t.model)).toEqual(['cmyk', 'cmyk', 'cmyk', 'cmyk', 'spot']);
  });

  it('matches colors the way Skia prints them (4 decimals) and rejects everything else', () => {
    for (const e of table) {
      const [r, g, b] = sentinelOperands(e).split(' ').map(Number) as [number, number, number];
      expect(sentinels.lookup(r, g, b)?.key).toBe(e.key);
    }
    expect(sentinels.lookup(0.5, 0.5, 0.5)).toBeNull();
    expect(sentinels.lookup(0, 0, 0)).toBeNull(); // pure black is Chromium's own, not a sentinel
  });
});

describe('rewriteContent: sentinels become exact CMYK and spot colors', () => {
  it('turns 100K black text into K-only: `0 0 0 1 k`, no overprint state', () => {
    const r = rewrite(`q ${rg('black|100|ko')} BT /F1 12 Tf (Hi) Tj ET Q`);
    expect(r.out).toContain('0 0 0 1 k');
    expect(r.out).not.toMatch(/ rg\b/);
    expect(r.out).not.toContain('gs');
    expect(r.stats.cmykOut).toBe(1);
    expect(r.stats.sentinelHits.get('black|100|ko')).toBe(1);
  });

  it('turns a CMYK swatch into its exact values, and strokes into K / SCN', () => {
    const r = rewrite(`${rg('orange|100|ko')} 0 0 10 10 re f ${rg('orange|100|ko', 'RG')} 0 0 10 10 re S`);
    expect(r.out).toContain('0 0.6 1 0 k');
    expect(r.out).toContain('0 0.6 1 0 K');
  });

  it('puts a spot color on its own Separation space, with the tint as the scn operand', () => {
    const r = rewrite(`${rg('pms|40|ko')} 0 0 10 10 re f`);
    expect(r.out).toContain('/GalleySep0 cs 0.4 scn');
    expect(r.spotsUsed).toEqual(new Set(['PANTONE 185 C']));
    expect(r.stats.spotOut).toBe(1);
  });

  it('maps Chromium’s own black and white to K and paper, and reports every other RGB', () => {
    const r = rewrite('0 0 0 rg 1 1 1 rg 0.3 0.4 0.5 rg');
    expect(r.out).toContain('0 0 0 1 k');
    expect(r.out).toContain('0 0 0 0 k');
    expect(r.stats.unmatched).toHaveLength(1);
    expect(r.stats.unmatched[0]).toContain('0.3 0.4 0.5 rg');
    expect(r.stats.defaultBlack).toBe(1);
    expect(r.stats.defaultWhite).toBe(1);
  });
});

describe('rewriteContent: overprint', () => {
  it('turns overprint on for an overprinting ink and off again for the next knockout ink', () => {
    const r = rewrite(`${rg('black|100|op')} 0 0 10 10 re f ${rg('orange|100|ko')} 0 0 10 10 re f`);
    expect(r.out).toMatch(/\/GalleyOP01 gs\n0 0 0 1 k/);
    expect(r.out).toMatch(/\/GalleyOP00 gs\n0 0.6 1 0 k/);
    expect(r.gsUsed).toEqual(new Set(['GalleyOP01', 'GalleyOP00']));
  });

  it('keeps stroke and fill overprint apart', () => {
    const r = rewrite(`${rg('black|100|op', 'RG')} ${rg('orange|100|ko')}`);
    expect(r.out).toContain('/GalleyOP10 gs'); // stroke overprint only
    expect(r.out).not.toContain('GalleyOP11');
  });

  it('never lets overprint leak into a form or an image: it is switched off before Do, sh and inline images', () => {
    const r = rewrite(`${rg('black|100|op')} 0 0 10 10 re f /Fm1 Do`);
    expect(r.out).toMatch(/\/GalleyOP00 gs\n\/Fm1 Do/);
  });

  it('follows q / Q: overprint set inside a q block does not outlive it', () => {
    const r = rewrite(`q ${rg('black|100|op')} 0 0 1 1 re f Q ${rg('black|100|ko')} 0 0 1 1 re f`);
    // after Q the tracked state is knockout again, and the real state was restored by Q, so no extra gs is needed
    const gsCount = (r.out.match(/ gs\n/g) ?? []).length;
    expect(gsCount).toBe(1);
  });
});

describe('rewriteContent: everything it does not own passes through untouched', () => {
  it('keeps text, paths and clips byte for byte', () => {
    const body = 'q 0 0 100 100 re W n BT /F1 12 Tf 1 0 0 -1 36 40 Tm [<002600ee> -20 <00a1>] TJ ET Q';
    expect(rewrite(body).out).toBe(body);
  });

  it('does not rewrite colors inside strings or comments', () => {
    const body = `(${sentinelOperands(entryByKey(table, 'orange|100|ko'))} rg) Tj % ${rg('orange|100|ko')}\n`;
    const r = rewrite(body);
    expect(r.out).toBe(body);
    expect(r.stats.rgbOps).toBe(0);
  });

  it('counts DeviceGray, DeviceCMYK and pattern colors as passed through, and flags scn in a space it cannot read', () => {
    const r = rewrite('0.5 g 0 0 0 1 k /Pattern cs /P1 scn /Cs9 cs 0.2 0.3 0.4 scn');
    expect(r.stats.otherColorOps.get('g')).toBe(1);
    expect(r.stats.otherColorOps.get('k')).toBe(1);
    expect(r.stats.unhandled.some((u) => u.includes('scn in colour space /Cs9'))).toBe(true);
  });
});
