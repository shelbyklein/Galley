import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addLayer,
  ancestorIds,
  boundsOf,
  groupFrames,
  makeLayer,
  MissingObjectError,
  getFrame,
  paintOrder,
  pageFrameIds,
  pageIdOf,
  parentOf,
  rotatedBounds,
  setPageProps,
  sheetInsets,
  sheetSize,
  subtreeIds,
  topLevelAncestor,
  type HistoryState,
} from '../src';
import { history, rectFrame, run } from './helpers';

const add = (h: HistoryState, id: string, props = {}) => run(h, addFrame, { frame: rectFrame(id, props), pageId: 'page_1' });

describe('queries', () => {
  it('paints layer by layer, bottom first, then in stacking order, with groups expanded in place', () => {
    let h = run(history(), addLayer, { layer: makeLayer({ id: 'layer_2', name: 'Top' }) });
    h = add(h, 'a');
    h = add(h, 'top', { layerId: 'layer_2' });
    h = add(h, 'b');
    h = add(h, 'c');
    h = run(h, groupFrames, { ids: ['b', 'c'], groupId: 'g' });
    expect(pageFrameIds(h.doc, 'page_1')).toEqual(['a', 'g', 'top']);
    expect(paintOrder(h.doc, 'page_1').map((f) => f.id)).toEqual(['a', 'b', 'c', 'top']);
  });

  it('finds parents, ancestors, subtrees and pages', () => {
    let h = ['a', 'b', 'c'].reduce((acc, id) => add(acc, id), history());
    h = run(h, groupFrames, { ids: ['a', 'b'], groupId: 'inner' });
    h = run(h, groupFrames, { ids: ['inner', 'c'], groupId: 'outer' });
    expect(parentOf(h.doc, 'a')).toBe('inner');
    expect(parentOf(h.doc, 'outer')).toBeNull();
    expect(ancestorIds(h.doc, 'a')).toEqual(['inner', 'outer']);
    expect(topLevelAncestor(h.doc, 'a')).toBe('outer');
    expect(topLevelAncestor(h.doc, 'outer')).toBe('outer');
    expect(subtreeIds(h.doc, 'outer').sort()).toEqual(['a', 'b', 'c', 'inner', 'outer']);
    expect(pageIdOf(h.doc, 'b')).toBe('page_1');
  });

  it('computes bounds including rotation, and a group\'s bounds from its children', () => {
    let h = add(add(history(), 'a', { x: 0, y: 0, w: 100, h: 50 }), 'b', { x: 200, y: 100, w: 100, h: 100, rotation: 45 });
    expect(boundsOf(h.doc, 'a')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    const b = boundsOf(h.doc, 'b')!;
    expect(b.w).toBeCloseTo(100 * Math.SQRT2, 6);
    expect(b.x + b.w / 2).toBeCloseTo(250, 6);
    h = run(h, groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    const g = boundsOf(h.doc, 'g')!;
    expect(g.x).toBe(0);
    expect(g.y).toBeLessThan(100);
    expect(g.x + g.w).toBeCloseTo(250 + (100 * Math.SQRT2) / 2, 6);
    expect(rotatedBounds({ x: 0, y: 0, w: 100, h: 50 }, 90)).toEqual({ x: 25, y: -25, w: 50, h: 100 });
  });

  it('sizes the printed sheet as trim plus the larger of bleed and slug on each side', () => {
    const h = run(history(), setPageProps, {
      id: 'page_1',
      props: { width: 792, height: 1224, bleed: { top: 9, right: 9, bottom: 9, left: 9 }, slug: { top: 36, right: 36, bottom: 36, left: 36 } },
    });
    const page = h.doc.pages.page_1!;
    expect(sheetInsets(page)).toEqual({ top: 36, right: 36, bottom: 36, left: 36 });
    expect(sheetSize(page)).toEqual({ width: 864, height: 1296 });
    const noSlug = run(h, setPageProps, { id: 'page_1', props: { slug: { top: 0, right: 0, bottom: 0, left: 0 } } });
    expect(sheetSize(noSlug.doc.pages.page_1!)).toEqual({ width: 810, height: 1242 });
  });

  it('throws a typed error for a missing object', () => {
    expect(() => getFrame(history().doc, 'ghost')).toThrow(MissingObjectError);
  });
});
