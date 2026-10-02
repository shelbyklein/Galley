import { describe, expect, it } from 'vitest';
import { handlePoint, rectBox, type OrientedBox } from '../canvas/geometry';
import { resizeBox, rotateGeometryAbout, rotationDelta, scaleFrameGeometry } from './transform';

const box: OrientedBox = { cx: 100, cy: 50, w: 100, h: 50, rotation: 0 }; // x 50..150, y 25..75

describe('resizeBox', () => {
  it('drags a corner while the opposite corner stays put', () => {
    const r = resizeBox(box, 'se', { x: 200, y: 125 });
    expect(r).toMatchObject({ w: 150, h: 100, cx: 125, cy: 75, rotation: 0 });
    // top-left unchanged
    expect(r.cx - r.w / 2).toBe(50);
    expect(r.cy - r.h / 2).toBe(25);
  });

  it('drags an edge in one axis only', () => {
    const r = resizeBox(box, 'w', { x: 20, y: 999 });
    expect(r).toMatchObject({ w: 130, h: 50, cy: 50 });
    expect(r.cx + r.w / 2).toBe(150);
  });

  it('resizes from the center with alt', () => {
    const r = resizeBox(box, 'e', { x: 180, y: 50 }, { alt: true });
    expect(r).toMatchObject({ cx: 100, cy: 50, w: 160, h: 50 });
    const c = resizeBox(box, 'nw', { x: 30, y: 5 }, { alt: true });
    expect(c).toMatchObject({ cx: 100, cy: 50, w: 140, h: 90 });
  });

  it('keeps proportions with shift: a corner follows the larger scale', () => {
    const r = resizeBox(box, 'se', { x: 250, y: 80 }, { shift: true });
    // width asks for 200/100 = 2, height for 55/50 = 1.1: scale 2
    expect(r.w).toBe(200);
    expect(r.h).toBe(100);
    expect(r.cx - r.w / 2).toBe(50);
    expect(r.cy - r.h / 2).toBe(25);
  });

  it('shift on an edge scales the other axis about the middle', () => {
    const r = resizeBox(box, 'e', { x: 250, y: 50 }, { shift: true });
    expect(r).toMatchObject({ w: 200, h: 100, cy: 50 });
    expect(r.cx - r.w / 2).toBe(50);
  });

  it('never goes below the minimum size', () => {
    const r = resizeBox(box, 'se', { x: 10, y: 5 });
    expect(r.w).toBe(1);
    expect(r.h).toBe(1);
    expect(r.cx - r.w / 2).toBe(50);
  });

  it('resizes a rotated box along its own axes, keeping the opposite corner fixed in the page', () => {
    const rotated: OrientedBox = { cx: 100, cy: 100, w: 80, h: 40, rotation: 90 };
    const anchorBefore = handlePoint(rotated, 'nw');
    // 'se' of a 90-degree box is bottom-left on the page; drag it 20 points further along the box's x axis (page +y)
    const se = handlePoint(rotated, 'se');
    const r = resizeBox(rotated, 'se', { x: se.x, y: se.y + 20 });
    expect(r.w).toBeCloseTo(100, 9);
    expect(r.h).toBeCloseTo(40, 9);
    expect(r.rotation).toBe(90);
    const anchorAfter = handlePoint(r, 'nw');
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 9);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 9);
  });

  it('keeps a line at zero height', () => {
    const line: OrientedBox = { cx: 100, cy: 100, w: 100, h: 0, rotation: 0 };
    const r = resizeBox(line, 'e', { x: 200, y: 140 }, { lockHeight: true });
    expect(r).toMatchObject({ w: 150, h: 0, cy: 100, cx: 125 });
  });
});

describe('scaleFrameGeometry', () => {
  const from = { x: 0, y: 0, w: 100, h: 100 };

  it('maps a frame into the scaled rectangle', () => {
    const g = scaleFrameGeometry({ x: 10, y: 20, w: 30, h: 40, rotation: 0 }, from, { x: 0, y: 0, w: 200, h: 50 });
    expect(g).toEqual({ x: 20, y: 10, w: 60, h: 20, rotation: 0 });
  });

  it('follows the rectangle when it moves', () => {
    const g = scaleFrameGeometry({ x: 0, y: 0, w: 100, h: 100, rotation: 0 }, from, { x: 50, y: 60, w: 100, h: 100 });
    expect(g).toEqual({ x: 50, y: 60, w: 100, h: 100, rotation: 0 });
  });

  it('swaps the scale axes for a quarter-turned frame and uses the mean otherwise', () => {
    const to = { x: 0, y: 0, w: 200, h: 50 };
    const quarter = scaleFrameGeometry({ x: 40, y: 40, w: 20, h: 10, rotation: 90 }, from, to);
    expect([quarter.w, quarter.h]).toEqual([10, 20]);
    const skew = scaleFrameGeometry({ x: 40, y: 40, w: 20, h: 10, rotation: 30 }, from, to);
    expect(skew.w).toBeCloseTo(20, 9); // sqrt(2 * 0.5) = 1
    expect(skew.h).toBeCloseTo(10, 9);
  });
});

describe('rotation', () => {
  it('rotates a frame about a pivot and about itself', () => {
    const f = { x: 90, y: 40, w: 20, h: 20, rotation: 0 }; // center (100, 50)
    const about = rotateGeometryAbout(f, { x: 0, y: 50 }, 90);
    expect(about.x + about.w / 2).toBeCloseTo(0, 9);
    expect(about.y + about.h / 2).toBeCloseTo(150, 9);
    expect(about.rotation).toBe(90);
    const self = rotateGeometryAbout(f, { x: 100, y: 50 }, 45);
    expect(self).toMatchObject({ x: 90, y: 40, rotation: 45 });
  });

  it('normalizes the angle to (-180, 180]', () => {
    expect(rotateGeometryAbout({ x: 0, y: 0, w: 10, h: 10, rotation: 170 }, { x: 5, y: 5 }, 30).rotation).toBe(-160);
  });

  it('measures the sweep around the pivot, and snaps to 45 degrees with shift', () => {
    const pivot = { x: 0, y: 0 };
    expect(rotationDelta(pivot, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9);
    expect(rotationDelta(pivot, { x: 10, y: 0 }, { x: 10, y: 3 }, { shift: true })).toBe(0);
    expect(rotationDelta(pivot, { x: 10, y: 0 }, { x: 10, y: 9 }, { shift: true })).toBe(45);
    // total rotation snaps, not just the turn: base 10 + sweep 30 = 40, nearest multiple of 45 is 45, so apply 35
    const delta = rotationDelta(pivot, { x: 10, y: 0 }, { x: 10 * Math.cos(Math.PI / 6), y: 10 * Math.sin(Math.PI / 6) }, { shift: true, baseRotation: 10 });
    expect(delta).toBeCloseTo(35, 9);
  });

  it('rectBox is axis aligned', () => {
    expect(rectBox({ x: 10, y: 20, w: 30, h: 40 })).toEqual({ cx: 25, cy: 40, w: 30, h: 40, rotation: 0 });
  });
});
