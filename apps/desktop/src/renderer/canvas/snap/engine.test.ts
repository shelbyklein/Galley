import { addGuide, applyCommand, groupFrames, makeLayer, addLayer, setLayerProps } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { blank, LAYER, PAGE, rect, withFrames } from '../../tools/testing';
import { collectSnapTargets, pageTargets, snapAxis, snapPoint, snapRect, SNAP_PX, type SnapTarget } from './engine';

const at = (targets: SnapTarget[], axis: 'x' | 'y') => targets.filter((t) => t.axis === axis).map((t) => [t.value, t.kind]);

describe('targets', () => {
  it('lists page edges, centers, margins, columns and bleed', () => {
    const doc = blank({ width: 600, height: 800, margins: { top: 40, right: 30, bottom: 50, left: 20 }, columns: { count: 3, gutter: 10 }, bleed: 9 });
    const t = pageTargets(doc.pages[PAGE]!);
    const xs = at(t, 'x');
    expect(xs).toEqual(
      expect.arrayContaining([
        [0, 'page-edge'],
        [600, 'page-edge'],
        [300, 'page-center'],
        [20, 'margin'],
        [570, 'margin'],
        [-9, 'bleed'],
        [609, 'bleed'],
      ]),
    );
    // content 550 wide, gutters 2 x 10: columns of 176.666...
    const col = (550 - 20) / 3;
    expect(xs).toEqual(expect.arrayContaining([[20, 'column'], [20 + col, 'column'], [20 + col + 10, 'column'], [20 + 2 * col + 10, 'column'], [20 + 2 * (col + 10), 'column'], [570, 'column']]));
    expect(at(t, 'y')).toEqual(expect.arrayContaining([[0, 'page-edge'], [800, 'page-edge'], [400, 'page-center'], [40, 'margin'], [750, 'margin'], [-9, 'bleed'], [809, 'bleed']]));
  });

  it('has no column or bleed targets for one column and no bleed', () => {
    const t = pageTargets(blank().pages[PAGE]!);
    expect(t.filter((x) => x.kind === 'column' || x.kind === 'bleed')).toEqual([]);
  });

  it('leaves guides, margins, columns and bleed out when guides are hidden', () => {
    const doc = blank({ bleed: 9, columns: { count: 2, gutter: 12 } });
    const kinds = new Set(pageTargets(doc.pages[PAGE]!, false).map((t) => t.kind));
    expect([...kinds].sort()).toEqual(['page-center', 'page-edge']);
  });

  it('adds ruler guides and the edges and centers of other objects, but not excluded ones', () => {
    let h = withFrames([rect('a', 100, 200, 50, 40), rect('b', 300, 100, 20, 20)]);
    h = applyCommand(h, addGuide, { guide: { id: 'g1', orientation: 'vertical', position: 123, pageId: PAGE } });
    h = applyCommand(h, addGuide, { guide: { id: 'g2', orientation: 'horizontal', position: 456, pageId: PAGE } });
    const t = collectSnapTargets(h.doc, PAGE, { exclude: new Set(['b']) });
    expect(t).toContainEqual({ axis: 'x', value: 123, kind: 'guide' });
    expect(t).toContainEqual({ axis: 'y', value: 456, kind: 'guide' });
    expect(t).toContainEqual({ axis: 'x', value: 100, kind: 'object-edge', span: [200, 240] });
    expect(t).toContainEqual({ axis: 'x', value: 125, kind: 'object-center', span: [200, 240] });
    expect(t).toContainEqual({ axis: 'y', value: 240, kind: 'object-edge', span: [100, 150] });
    expect(t.some((x) => x.value === 300 || x.value === 310)).toBe(false);
  });

  it('excludes the children of an excluded group, and uses rotated bounds', () => {
    let h = withFrames([rect('a', 0, 0, 10, 10), rect('b', 100, 100, 100, 20, { rotation: 90 })]);
    h = applyCommand(h, groupFrames, { ids: ['a'], groupId: 'g' });
    const t = collectSnapTargets(h.doc, PAGE, { exclude: new Set(['g']), guides: false });
    expect(t.filter((x) => x.kind === 'object-edge' && x.axis === 'x').map((x) => x.value)).toEqual([140, 160]);
  });

  it('skips objects on hidden layers', () => {
    let h = withFrames([rect('a', 100, 100, 10, 10)]);
    h = applyCommand(h, addLayer, { layer: makeLayer({ id: 'l2', name: 'Two' }) });
    h = applyCommand(h, setLayerProps, { id: LAYER, props: { visible: false } });
    expect(collectSnapTargets(h.doc, PAGE).some((t) => t.kind === 'object-edge')).toBe(false);
  });
});

describe('snapAxis', () => {
  const targets: SnapTarget[] = [
    { axis: 'x', value: 36, kind: 'margin' },
    { axis: 'x', value: 100, kind: 'object-edge' },
  ];

  it('moves the nearest candidate onto the nearest target within the threshold', () => {
    const r = snapAxis([39, 80, 120], targets, 4);
    expect(r.snapped).toBe(true);
    expect(r.delta).toBe(-3);
    expect(r.hits.map((h) => h.value)).toEqual([36]);
  });

  it('does nothing outside the threshold', () => {
    expect(snapAxis([42, 120], targets, 4)).toEqual({ delta: 0, hits: [], snapped: false });
  });

  it('prefers a margin over an object at the same distance', () => {
    const t: SnapTarget[] = [
      { axis: 'x', value: 102, kind: 'object-edge' },
      { axis: 'x', value: 102, kind: 'margin' },
    ];
    const r = snapAxis([100], t, 4);
    expect(r.delta).toBe(2);
    expect(r.hits.map((h) => h.kind)).toEqual(['object-edge', 'margin']);
  });

  it('reports every target the snapped candidates land on', () => {
    const t: SnapTarget[] = [
      { axis: 'x', value: 50, kind: 'margin' },
      { axis: 'x', value: 150, kind: 'object-edge' },
    ];
    // left edge 48 -> 50 (delta 2), and the right edge 148 -> 150 is on the object too
    const r = snapAxis([48, 148], t, 4);
    expect(r.delta).toBe(2);
    expect(r.hits.map((h) => h.value).sort((a, b) => a - b)).toEqual([50, 150]);
  });
});

describe('snapRect', () => {
  const doc = blank({ width: 600, height: 800, margins: 36 });
  const targets = collectSnapTargets(doc, PAGE);

  it('lands exactly on the margin', () => {
    const r = snapRect({ x: 38.5, y: 300, w: 100, h: 50 }, targets, 4);
    expect(38.5 + r.dx).toBe(36);
    expect(r.snappedX).toBe(true);
    expect(r.snappedY).toBe(false);
    expect(r.lines).toEqual([{ axis: 'x', value: 36, from: 300, to: 350 }]);
  });

  it('snaps the right edge to the right margin and the center to the page center', () => {
    const right = snapRect({ x: 462, y: 300, w: 100, h: 50 }, targets, 4);
    expect(462 + right.dx + 100).toBe(564);
    const center = snapRect({ x: 252, y: 300, w: 100, h: 50 }, targets, 4);
    expect(252 + center.dx + 50).toBe(300);
    expect(center.lines).toEqual([{ axis: 'x', value: 300, from: 300, to: 350, label: 'center X' }]);
  });

  it('snaps both axes at once and returns a line for each', () => {
    const r = snapRect({ x: 34, y: 38, w: 10, h: 10 }, targets, 4);
    expect([r.dx, r.dy]).toEqual([2, -2]);
    expect(r.lines.map((l) => [l.axis, l.value])).toEqual([
      ['x', 36],
      ['y', 36],
    ]);
  });

  it('lets one axis be excluded', () => {
    const r = snapRect({ x: 34, y: 38, w: 10, h: 10 }, targets, 4, { y: false });
    expect([r.dx, r.dy]).toEqual([2, 0]);
  });

  it('draws the smart guide out to the object it aligned with', () => {
    const h = withFrames([rect('other', 300, 500, 60, 60)]);
    const t = collectSnapTargets(h.doc, PAGE, { guides: false });
    const r = snapRect({ x: 302, y: 100, w: 40, h: 40 }, t, 4);
    expect(r.dx).toBe(-2);
    expect(r.lines).toContainEqual({ axis: 'x', value: 300, from: 100, to: 560 });
  });

  it('the threshold is in screen pixels: the same 3 px at any zoom', () => {
    for (const zoom of [0.25, 1, 4]) {
      const threshold = SNAP_PX / zoom;
      const near = snapRect({ x: 36 + 3 / zoom, y: 300, w: 10, h: 10 }, targets, threshold);
      expect(near.snappedX).toBe(true);
      const far = snapRect({ x: 36 + 5 / zoom, y: 300, w: 10, h: 10 }, targets, threshold);
      expect(far.snappedX).toBe(false);
    }
  });

  it('snaps a point', () => {
    const r = snapPoint({ x: 37, y: 799 }, targets, 4);
    expect([37 + r.dx, 799 + r.dy]).toEqual([36, 800]);
  });
});
