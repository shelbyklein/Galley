import { describe, expect, it } from 'vitest';
import { editContent } from './ImageContentPanel';

describe('image-local content controls', () => {
  const rect = { x: -20, y: 10, w: 400, h: 200 };
  it('allows arbitrary offsets and nonuniform size', () => {
    expect(editContent(rect, 'x', -80, false)).toEqual({ ...rect, x: -80 });
    expect(editContent(rect, 'h', 90, false)).toEqual({ ...rect, h: 90 });
  });
  it('changes both sizes proportionally while keeping the content origin', () => {
    expect(editContent(rect, 'w', 200, true)).toEqual({ x: -20, y: 10, w: 200, h: 100 });
  });
  it('rejects zero, negative, nonfinite and overflow sizes', () => {
    for (const value of [0, -1, Infinity, NaN]) expect(editContent(rect, 'w', value, true)).toBeNull();
    expect(editContent({ ...rect, h: 1e308 }, 'w', 1e308, true)).toBeNull();
  });
});
