import { sheetSize } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { applyExportOptions, exportPage, marksReach, pageBoxes } from '../src/geometry';
import { marksLayout, marksStream } from '../src/marks';
import { inkDoc } from './helpers';

const poster = () => inkDoc({ width: 792, height: 1224, bleed: 9, slug: 36 }).pages['page_1']!;

describe('marksReach', () => {
  it('is exactly the poster’s 36 pt slug for a 9 pt bleed', () => {
    expect(marksReach(9)).toBe(36);
    expect(marksReach(0)).toBe(27);
  });
});

describe('exportPage: how the options change the printed sheet', () => {
  it('default (bleed on, marks on) keeps the sheet the editor shows', () => {
    const page = poster();
    const p = exportPage(page, { bleed: true, marks: true });
    expect(p.bleed).toEqual(page.bleed);
    expect(sheetSize(p)).toEqual(sheetSize(page));
    expect(sheetSize(p)).toEqual({ width: 864, height: 1296 });
  });

  it('bleed off: no bleed, so the BleedBox will equal the TrimBox', () => {
    const p = exportPage(poster(), { bleed: false, marks: true });
    expect(p.bleed).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(pageBoxes(p).bleed).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // marks still need room (27 pt a side with no bleed); the poster's own 36 pt slug is larger, so it applies
    expect(sheetSize(p)).toEqual({ width: 864, height: 1296 });
    const small = exportPage(inkDoc({ width: 792, height: 1224, bleed: 9, slug: 0 }).pages['page_1']!, { bleed: false, marks: true });
    expect(sheetSize(small)).toEqual({ width: 792 + 54, height: 1224 + 54 });
  });

  it('marks on grows the slug to whatever the marks need, never shrinks the document slug', () => {
    const small = exportPage(inkDoc({ bleed: 18, slug: 0 }).pages['page_1']!, { bleed: true, marks: true });
    expect(small.slug.left).toBe(marksReach(18)); // 45
    const big = exportPage(inkDoc({ bleed: 9, slug: 72 }).pages['page_1']!, { bleed: true, marks: true });
    expect(big.slug.left).toBe(72);
  });

  it('marks off: the sheet is trim plus bleed, and the document slug is not printed', () => {
    const p = exportPage(poster(), { bleed: true, marks: false });
    expect(p.slug).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(sheetSize(p)).toEqual({ width: 792 + 18, height: 1224 + 18 });
    const bare = exportPage(poster(), { bleed: false, marks: false });
    expect(sheetSize(bare)).toEqual({ width: 792, height: 1224 }); // the sheet is the trim
  });

  it('applyExportOptions leaves everything but the page boxes alone and does not mutate its input', () => {
    const doc = inkDoc();
    const before = JSON.stringify(doc);
    const out = applyExportOptions(doc, { bleed: false, marks: false });
    expect(JSON.stringify(doc)).toBe(before);
    expect(out.frames).toBe(doc.frames);
    expect(out.pages['page_1']!.bleed.top).toBe(0);
    expect(out.pages['page_1']!.items).toEqual(doc.pages['page_1']!.items);
  });
});

describe('pageBoxes', () => {
  it('puts the trim box at (max(bleed, slug), ...) from the top-left of the sheet, with exactly the page size', () => {
    const b = pageBoxes(poster());
    expect(b.sheet).toEqual({ width: 864, height: 1296 });
    expect(b.trim).toEqual({ x: 36, y: 36, width: 792, height: 1224 });
    expect(b.bleed).toEqual({ top: 9, right: 9, bottom: 9, left: 9 });
  });
});

describe('crop marks', () => {
  const trim: [number, number, number, number] = [36, 36, 828, 1260];
  const bleed = { top: 9, right: 9, bottom: 9, left: 9 };

  it('draws eight ticks and four registration targets in the registration color, and nothing in the bleed', () => {
    const s = marksStream({ trim, bleed }, 'Reg');
    expect(s).toContain('/Reg CS 1 SCN');
    const ticks = s.split('\n').filter((l) => /^\S+ \S+ m \S+ \S+ l S$/.test(l));
    expect(ticks.length).toBe(8 + 8); // 8 crop ticks and 2 arms for each of the 4 targets
    // a left-hand horizontal tick runs from x = trim - bleed - 3 - 18 to trim - bleed - 3, at the trim edge's y
    expect(s).toContain('24 36 m 6 36 l S');
    for (const [from, to, y] of marksLayout({ trim, bleed }).horizontal) {
      expect(to - from).toBe(18);
      expect([36, 1260]).toContain(y);
      expect(Math.min(Math.abs(from - 36), Math.abs(to - 36), Math.abs(from - 828), Math.abs(to - 828))).toBeGreaterThanOrEqual(12); // outside the 9 pt bleed
    }
  });

  it('follows each side’s own bleed', () => {
    const layout = marksLayout({ trim, bleed: { top: 0, right: 18, bottom: 0, left: 0 } });
    const right = layout.horizontal.filter(([from]) => from > 828);
    expect(right[0]![0]).toBe(828 + 18 + 3);
    const left = layout.horizontal.filter(([, to]) => to < 36);
    expect(left[0]![1]).toBe(36 - 0 - 3);
  });
});
