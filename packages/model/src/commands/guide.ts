import type { Id } from '../ids';
import { guideSchema, type Guide } from '../schema';
import { defineCommand, fail } from './types';
import { assertFinite, own, pageOf } from './util';

export const addGuide = defineCommand<{ guide: Guide }>('guide.add', 'Add Guide', (d, { guide }) => {
  const r = guideSchema.safeParse(guide);
  if (!r.success) fail(`Invalid guide: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (d.guides[guide.id]) fail(`Guide "${guide.id}" already exists`);
  pageOf(d, guide.pageId);
  d.guides[guide.id] = own(guide);
});

/** Move a guide along its axis. Issue it once per pointer move inside a transaction while dragging. */
export const moveGuide = defineCommand<{ id: Id; position: number }>('guide.move', 'Move Guide', (d, { id, position }) => {
  assertFinite(position, 'position');
  const g = d.guides[id] ?? fail(`No guide "${id}"`);
  g.position = position;
});

export const removeGuide = defineCommand<{ id: Id }>('guide.remove', 'Delete Guide', (d, { id }) => {
  if (!d.guides[id]) fail(`No guide "${id}"`);
  delete d.guides[id];
});
