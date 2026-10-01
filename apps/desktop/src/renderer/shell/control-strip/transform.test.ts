import { addFrame, createDocument, groupFrames, paint, type Frame, type GalleyDocument } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../store/editorStore';
import { moveRefTo, refPointOf, refPointOfRect, resizeAboutRef, scaleLeaves, selectionGeometry, type Box, type RefPoint } from './transform';

const C: RefPoint = { x: 0.5, y: 0.5 };
const TL: RefPoint = { x: 0, y: 0 };
const BR: RefPoint = { x: 1, y: 1 };
const box = (p: Partial<Box> = {}): Box => ({ x: 10, y: 20, w: 100, h: 50, rotation: 0, ...p });
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

describe('reference points', () => {
  it('finds the point on an unrotated box', () => {
    expect(refPointOf(box(), TL)).toEqual({ x: 10, y: 20 });
    expect(refPointOf(box(), C)).toEqual({ x: 60, y: 45 });
    expect(refPointOf(box(), BR)).toEqual({ x: 110, y: 70 });
  });

  it('rides on the rotated box: a 90 degree turn moves the top-left corner', () => {
    // a 100 x 50 box at (10, 20) turned 90 degrees clockwise about its center (60, 45): its top-left corner goes to (85, -5)
    const p = refPointOf(box({ rotation: 90 }), TL);
    expect(p.x).toBeCloseTo(85, 9);
    expect(p.y).toBeCloseTo(-5, 9);
    expect(refPointOf(box({ rotation: 90 }), C)).toEqual({ x: 60, y: 45 });
  });
});

describe('X and Y', () => {
  it('typing X = 72 with the center reference point puts the center at exactly 72', () => {
    for (const w of [100, 33, 411.8, 0.75, 1]) {
      const moved = moveRefTo(box({ w }), C, { x: 72 });
      expect(moved.x + moved.w / 2).toBeCloseTo(72, 9);
      expect(moved.y).toBe(20);
    }
    expect(center(moveRefTo(box(), C, { x: 72 })).x).toBe(72); // exact for the representable sizes
  });

  it('places the other reference points too', () => {
    expect(moveRefTo(box(), TL, { x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
    expect(moveRefTo(box(), BR, { x: 612, y: 792 })).toMatchObject({ x: 512, y: 742 });
  });

  it('moves a rotated box by the difference', () => {
    const b = box({ rotation: 30 });
    const before = refPointOf(b, TL);
    const moved = moveRefTo(b, TL, { x: before.x + 10 });
    expect(refPointOf(moved, TL).x).toBeCloseTo(before.x + 10, 9);
    expect(refPointOf(moved, TL).y).toBeCloseTo(before.y, 9);
    expect(moved.rotation).toBe(30);
  });
});

describe('W, H and rotation hold the reference point', () => {
  it('resizing about the center keeps the center', () => {
    const next = resizeAboutRef(box(), C, { w: 200 });
    expect(center(next)).toEqual(center(box()));
    expect(next).toMatchObject({ w: 200, h: 50 });
  });

  it('resizing about the top-left keeps the corner, about the bottom-right keeps that corner', () => {
    expect(resizeAboutRef(box(), TL, { w: 200, h: 80 })).toMatchObject({ x: 10, y: 20, w: 200, h: 80 });
    expect(resizeAboutRef(box(), BR, { w: 200, h: 80 })).toMatchObject({ x: -90, y: -10, w: 200, h: 80 });
  });

  it('keeps the reference point of a rotated box in place when it is resized', () => {
    const b = box({ rotation: 25 });
    for (const ref of [TL, C, BR, { x: 1, y: 0 } as RefPoint]) {
      const before = refPointOf(b, ref);
      const after = refPointOf(resizeAboutRef(b, ref, { w: 150, h: 40 }), ref);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
  });

  it('rotating about a corner swings the box around that corner', () => {
    const next = resizeAboutRef(box(), TL, { rotation: 90 });
    expect(next.rotation).toBe(90);
    const corner = refPointOf(next, TL);
    expect(corner.x).toBeCloseTo(10, 9);
    expect(corner.y).toBeCloseTo(20, 9);
  });

  it('rotating about the center leaves x, y alone', () => {
    expect(resizeAboutRef(box(), C, { rotation: 45 })).toMatchObject({ x: 10, y: 20 });
  });
});

// ---------------------------------------------------------------------------------------------- selections

function docWithFrames(): { doc: GalleyDocument; ids: string[] } {
  const store = createEditorStore(createDocument({ engineVersion: 'test', page: { id: 'p' }, layer: { id: 'l' } }));
  const frame = (id: string, p: Partial<Extract<Frame, { type: 'rect' }>>): Frame => ({ id, type: 'rect', name: '', layerId: 'l', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: paint('black'), stroke: null, ...p });
  store.getState().dispatch(addFrame, { frame: frame('a', { x: 0, y: 0, w: 100, h: 50 }), pageId: 'p' });
  store.getState().dispatch(addFrame, { frame: frame('b', { x: 100, y: 50, w: 100, h: 50 }), pageId: 'p' });
  store.getState().dispatch(addFrame, { frame: frame('r', { x: 300, y: 0, rotation: 30 }), pageId: 'p' });
  return { doc: store.getState().history.doc, ids: ['a', 'b', 'r'] };
}

describe('selection geometry', () => {
  it('a single frame has its own box and can resize and rotate', () => {
    const { doc } = docWithFrames();
    const g = selectionGeometry(doc, ['a'])!;
    expect(g).toMatchObject({ mode: 'box', canResize: true, canRotate: true, box: { x: 0, y: 0, w: 100, h: 50, rotation: 0 } });
  });

  it('several frames are one rectangle that can move, and resize when none is rotated', () => {
    const { doc } = docWithFrames();
    const g = selectionGeometry(doc, ['a', 'b'])!;
    expect(g).toMatchObject({ mode: 'bounds', canResize: true, canRotate: false, box: { x: 0, y: 0, w: 200, h: 100 } });
    expect(selectionGeometry(doc, ['a', 'r'])!.canResize).toBe(false);
  });

  it('nothing selected, or ids that do not exist, give null', () => {
    const { doc } = docWithFrames();
    expect(selectionGeometry(doc, [])).toBeNull();
    expect(selectionGeometry(doc, ['nope'])).toBeNull();
  });

  it('a group is one rectangle over its leaves', () => {
    const store = createEditorStore(createDocument({ engineVersion: 'test', page: { id: 'p' }, layer: { id: 'l' } }));
    const frame = (id: string, x: number): Frame => ({ id, type: 'rect', name: '', layerId: 'l', x, y: 0, w: 10, h: 10, rotation: 0, fill: null, stroke: null });
    store.getState().dispatch(addFrame, { frame: frame('a', 0), pageId: 'p' });
    store.getState().dispatch(addFrame, { frame: frame('b', 30), pageId: 'p' });
    store.getState().dispatch(groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    const g = selectionGeometry(store.getState().history.doc, ['g'])!;
    expect(g.mode).toBe('bounds');
    expect(g.leafIds.sort()).toEqual(['a', 'b']);
    expect(g.box).toMatchObject({ x: 0, w: 40 });
  });

  it('scaling a multi-selection about a reference point scales positions and sizes together', () => {
    const { doc } = docWithFrames();
    const g = selectionGeometry(doc, ['a', 'b'])!;
    const patches = scaleLeaves(doc, g, TL, 400, 100);
    expect(patches.find((p) => p.id === 'a')!.props).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    expect(patches.find((p) => p.id === 'b')!.props).toEqual({ x: 200, y: 50, w: 200, h: 50 });
    const fromCenter = scaleLeaves(doc, g, C, 400, 100);
    const a = fromCenter.find((p) => p.id === 'a')!.props;
    expect(a.x).toBe(-100);
    expect(refPointOfRect({ x: 0, y: 0, w: 200, h: 100 }, C)).toEqual({ x: 100, y: 50 });
  });
});
