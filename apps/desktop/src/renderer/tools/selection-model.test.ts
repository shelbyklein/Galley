import { applyCommand, groupFrames } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { leafFrames, normalizeSelection, selectableIds, selectionBounds, selectionBox } from './selection-model';
import { PAGE, rect, withFrames } from './testing';

describe('selection model', () => {
  const grouped = () => applyCommand(withFrames([rect('a', 0, 0, 40, 40), rect('b', 100, 100, 40, 40), rect('c', 300, 0, 10, 10, { rotation: 90 })]), groupFrames, { ids: ['a', 'b'], groupId: 'g' });

  it('lists the selectable top-level frames bottom to top', () => {
    expect(selectableIds(grouped().doc, PAGE)).toEqual(['g', 'c']);
  });

  it('reduces ids to top-level, unique frames', () => {
    const doc = grouped().doc;
    expect(normalizeSelection(doc, ['a', 'b', 'g', 'ghost', 'c', 'c'])).toEqual(['g', 'c']);
  });

  it('collects the leaf frames of groups once each', () => {
    const doc = grouped().doc;
    expect(leafFrames(doc, ['g', 'c']).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('boxes one frame with its own rotation and several as their union bounds', () => {
    const doc = grouped().doc;
    const one = selectionBox(doc, ['c'])!;
    expect(one.single?.id).toBe('c');
    expect(one.box).toMatchObject({ cx: 305, cy: 5, w: 10, h: 10, rotation: 90 });
    const group = selectionBox(doc, ['g'])!;
    expect(group.single).toBeNull();
    expect(group.box).toEqual({ cx: 70, cy: 70, w: 140, h: 140, rotation: 0 });
    expect(selectionBounds(doc, ['g', 'c'])).toEqual({ x: 0, y: 0, w: 310, h: 140 });
    expect(selectionBox(doc, [])).toBeNull();
  });

  it('marks a line selection', () => {
    const doc = withFrames([{ ...rect('l', 0, 0, 100, 0), type: 'line' as const }]).doc;
    expect(selectionBox(doc, ['l'])!.line).toBe(true);
  });
});
