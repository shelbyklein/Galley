import type { Id } from '../ids';
import { defineCommand, fail } from './types';
import { assertFinite, frameOf } from './util';

/** Absolute geometry for one box frame; omitted fields are left alone. */
export interface FrameGeometry {
  id: Id;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
}

const KEYS = ['x', 'y', 'w', 'h', 'rotation'] as const;

/**
 * Set absolute geometry on several box frames in one command: what a drag, a resize or a rotate gesture issues on every
 * pointer move (inside one transaction), because each frame ends up at its own computed position rather than moving by
 * a common delta. Absolute values, unlike `frame.move`'s deltas, add no rounding error however many moves a drag makes.
 * Groups have no geometry: pass their children.
 */
export const transformFrames = defineCommand<{ changes: FrameGeometry[] }>('frame.transform', 'Transform', (d, { changes }) => {
  for (const change of changes) {
    for (const k of KEYS) if (change[k] !== undefined) assertFinite(change[k]!, k);
    if (change.w !== undefined && change.w < 0) fail('w cannot be negative');
    if (change.h !== undefined && change.h < 0) fail('h cannot be negative');
    if (frameOf(d, change.id).type === 'group') fail('A group has no geometry of its own; transform its children');
  }
  for (const change of changes) {
    const f = frameOf(d, change.id);
    if (f.type === 'group') continue;
    for (const k of KEYS) if (change[k] !== undefined) f[k] = change[k]!;
  }
});
