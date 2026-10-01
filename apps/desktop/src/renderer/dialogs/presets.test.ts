import { createDocument, parseDocument, serializeDocument, uniformInsets } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { CUSTOM_PRESET, defaultNewDocumentSpec, PAGE_PRESETS, pageFromSpec, presetForSize } from './presets';

describe('page presets', () => {
  it('are exact point sizes', () => {
    const size = (id: string) => {
      const p = PAGE_PRESETS.find((x) => x.id === id)!;
      return [p.width, p.height];
    };
    expect(size('letter')).toEqual([612, 792]);
    expect(size('tabloid')).toEqual([792, 1224]);
    expect(size('18x24')).toEqual([1296, 1728]);
    expect(size('24x36')).toEqual([1728, 2592]);
    const [a4w, a4h] = size('a4');
    expect(a4w).toBeCloseTo(595.2756, 4);
    expect(a4h).toBeCloseTo(841.8898, 4);
    const [a3w, a3h] = size('a3');
    expect(a3w).toBeCloseTo(841.8898, 4);
    expect(a3h).toBeCloseTo(1190.5512, 4);
  });

  it('lists the six presets of the plan, in order', () => {
    expect(PAGE_PRESETS.map((p) => p.label)).toEqual(['Letter', 'Tabloid', 'A4', 'A3', '18 × 24 in', '24 × 36 in']);
  });

  it('recognizes a size in either orientation, and custom sizes as none', () => {
    expect(presetForSize(792, 1224)?.id).toBe('tabloid');
    expect(presetForSize(1224, 792)?.id).toBe('tabloid');
    expect(presetForSize(500, 500)).toBeUndefined();
    expect(CUSTOM_PRESET).toBe('custom');
  });
});

describe('pageFromSpec', () => {
  it('makes the page the spec describes', () => {
    const spec = { ...defaultNewDocumentSpec(), margins: uniformInsets(18), columns: { count: 3, gutter: 9 }, bleed: uniformInsets(9), slug: uniformInsets(36) };
    const { page, error } = pageFromSpec(spec);
    expect(error).toBeNull();
    expect(page).toMatchObject({ width: 612, height: 792, margins: uniformInsets(18), columns: { count: 3, gutter: 9 }, bleed: uniformInsets(9), slug: uniformInsets(36), items: [] });
  });

  it('explains margins that leave no room and gutters wider than the columns', () => {
    expect(pageFromSpec({ ...defaultNewDocumentSpec(), margins: uniformInsets(400) }).error).toMatch(/margins/);
    expect(pageFromSpec({ ...defaultNewDocumentSpec(), columns: { count: 20, gutter: 100 } }).error).toMatch(/columns/);
  });

  it('a document made from every preset survives save and reopen with the exact size', () => {
    for (const p of PAGE_PRESETS) {
      const spec = { ...defaultNewDocumentSpec(), width: p.width, height: p.height };
      const doc = createDocument({ engineVersion: 'test', page: spec });
      const again = parseDocument(serializeDocument(doc));
      const page = again.pages[again.pageOrder[0]!]!;
      expect([page.width, page.height]).toEqual([p.width, p.height]);
    }
  });
});
