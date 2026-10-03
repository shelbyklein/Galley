import { expect, it } from 'vitest';
import { effectiveImagePpi } from '../src/image';
it('computes X/Y effective PPI from content size despite nonuniform scale, crop and rotation', () => {
  const frame = { content: { x: -20, y: -50, w: 288, h: 72 }, rotation: 90 };
  expect(effectiveImagePpi({ width: 1200, height: 600 }, frame)).toEqual({ x: 300, y: 600 });
  expect(effectiveImagePpi({ width: 1200, height: 600 }, { content: null })).toBeNull();
});
