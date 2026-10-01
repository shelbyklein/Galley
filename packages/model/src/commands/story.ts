import type { Id } from '../ids';
import { storyDocSchema, textAttrsSchema, type PMNode, type TextAttrs } from '../text/story';
import { defineCommand, fail } from './types';
import { own, storyOf } from './util';

/** Replace a story's text. (Phase 2 replaces whole-document writes with ProseMirror transaction steps.) */
export const setStoryDoc = defineCommand<{ storyId: Id; doc: PMNode }>('story.setDoc', 'Edit Text', (d, { storyId, doc }) => {
  const story = storyOf(d, storyId);
  const r = storyDocSchema.safeParse(doc);
  if (!r.success) fail(`Invalid story: ${r.error.issues.map((i) => i.message).join('; ')}`);
  story.doc = own(doc);
});

/** Change the story's default paragraph style: font, size, leading, alignment, color. */
export const setStoryDefaults = defineCommand<{ storyId: Id; props: Partial<TextAttrs> }>('story.setDefaults', 'Change Text Style', (d, { storyId, props }) => {
  const story = storyOf(d, storyId);
  const r = textAttrsSchema.partial().safeParse(props);
  if (!r.success) fail(`Invalid text attributes: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (r.data.fill && !d.swatches[r.data.fill.swatchId]) fail(`No swatch "${r.data.fill.swatchId}"`);
  Object.assign(story.defaults, own(r.data));
});
