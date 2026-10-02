import { applyCommand, groupFrames, makeLayer, paint, setLayerProps, addLayer, SWATCH_BLACK, type Frame } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { framesInRect, hitTest } from './hit-test';
import { LAYER, PAGE, rect, withFrames } from './testing';

const ellipse = (id: string, x: number, y: number, w: number, h: number, props: Partial<Extract<Frame, { type: 'ellipse' }>> = {}): Frame => ({ ...rect(id, x, y, w, h), type: 'ellipse', ...props }) as Frame;
const line = (id: string, x: number, y: number, w: number, rotation = 0): Frame => ({ ...rect(id, x, y, w, 0, { rotation, fill: null, stroke: { paint: paint(SWATCH_BLACK), weight: 2 } }) });

describe('hitTest', () => {
  it('returns the top-most frame under the point', () => {
    const h = withFrames([rect('a', 0, 0, 100, 100), rect('b', 50, 50, 100, 100)]);
    expect(hitTest(h.doc, PAGE, { x: 75, y: 75 }, 2)).toBe('b');
    expect(hitTest(h.doc, PAGE, { x: 25, y: 25 }, 2)).toBe('a');
    expect(hitTest(h.doc, PAGE, { x: 300, y: 300 }, 2)).toBeNull();
  });

  it('uses the rotated shape, not its bounds', () => {
    const h = withFrames([rect('a', 0, 0, 100, 20, { rotation: 90 })]); // a vertical bar centered on (50, 10), 20 wide, 100 tall
    expect(hitTest(h.doc, PAGE, { x: 50, y: -30 }, 0)).toBe('a');
    expect(hitTest(h.doc, PAGE, { x: 20, y: 10 }, 0)).toBeNull();
  });

  it('hits an ellipse inside its curve only', () => {
    const h = withFrames([ellipse('e', 0, 0, 100, 100)]);
    expect(hitTest(h.doc, PAGE, { x: 50, y: 50 }, 0)).toBe('e');
    expect(hitTest(h.doc, PAGE, { x: 3, y: 3 }, 0)).toBeNull(); // the bounding-box corner
  });

  it('an unfilled rectangle is hit on its outline, not its interior', () => {
    const h = withFrames([rect('r', 0, 0, 100, 100, { fill: null, stroke: { paint: paint(SWATCH_BLACK), weight: 1 } })]);
    expect(hitTest(h.doc, PAGE, { x: 50, y: 50 }, 3)).toBeNull();
    expect(hitTest(h.doc, PAGE, { x: 50, y: 1 }, 3)).toBe('r');
    expect(hitTest(h.doc, PAGE, { x: 99, y: 40 }, 3)).toBe('r');
    expect(hitTest(h.doc, PAGE, { x: 102, y: 40 }, 3)).toBe('r');
    expect(hitTest(h.doc, PAGE, { x: 110, y: 40 }, 3)).toBeNull();
  });

  it('a text frame is hit anywhere inside, with no fill', () => {
    const h = withFrames([{ id: 't', type: 'text', name: '', layerId: LAYER, x: 10, y: 10, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId: 's', inset: 0 }]);
    expect(hitTest(h.doc, PAGE, { x: 60, y: 30 }, 0)).toBe('t');
  });

  it('hits a line along its length, at any angle, within the tolerance', () => {
    const h = withFrames([line('l', 0, 100, 100), line('d', 200, 200, 100, 90)]);
    expect(hitTest(h.doc, PAGE, { x: 50, y: 102 }, 2)).toBe('l');
    expect(hitTest(h.doc, PAGE, { x: 50, y: 110 }, 2)).toBeNull();
    expect(hitTest(h.doc, PAGE, { x: 120, y: 100 }, 2)).toBeNull();
    // the rotated line is vertical through (250, 200), from y 150 to 250
    expect(hitTest(h.doc, PAGE, { x: 250, y: 160 }, 2)).toBe('d');
    expect(hitTest(h.doc, PAGE, { x: 250, y: 140 }, 2)).toBeNull();
  });

  it('selects the group when a child is hit', () => {
    let h = withFrames([rect('a', 0, 0, 40, 40), rect('b', 100, 100, 40, 40)]);
    h = applyCommand(h, groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    expect(hitTest(h.doc, PAGE, { x: 20, y: 20 }, 0)).toBe('g');
    expect(hitTest(h.doc, PAGE, { x: 70, y: 70 }, 0)).toBeNull(); // between the children, inside the group's bounds
  });

  it('skips hidden and locked layers', () => {
    let h = withFrames([rect('a', 0, 0, 100, 100)]);
    h = applyCommand(h, addLayer, { layer: makeLayer({ id: 'top', name: 'Top' }) });
    h = applyCommand(h, setLayerProps, { id: LAYER, props: { locked: true } });
    expect(hitTest(h.doc, PAGE, { x: 50, y: 50 }, 0)).toBeNull();
    h = applyCommand(h, setLayerProps, { id: LAYER, props: { locked: false, visible: false } });
    expect(hitTest(h.doc, PAGE, { x: 50, y: 50 }, 0)).toBeNull();
  });
});

describe('framesInRect', () => {
  it('selects every frame the rectangle touches', () => {
    const h = withFrames([rect('a', 0, 0, 50, 50), rect('b', 100, 0, 50, 50), rect('c', 0, 200, 50, 50)]);
    expect(framesInRect(h.doc, PAGE, { x: 40, y: 10, w: 80, h: 10 })).toEqual(['a', 'b']);
    expect(framesInRect(h.doc, PAGE, { x: 300, y: 300, w: 10, h: 10 })).toEqual([]);
  });

  it('uses the bounds of rotated frames', () => {
    const h = withFrames([rect('r', 0, 0, 100, 20, { rotation: 90 })]); // bounds x 40..60, y -40..60
    expect(framesInRect(h.doc, PAGE, { x: 45, y: -35, w: 5, h: 5 })).toEqual(['r']);
    expect(framesInRect(h.doc, PAGE, { x: 0, y: 0, w: 30, h: 30 })).toEqual([]);
  });
});
