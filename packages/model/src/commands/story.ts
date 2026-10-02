/**
 * Commands that change a story's text and its formatting. All of them keep the story document in canonical form and check
 * every reference (paragraph styles, character styles, swatches) before storing it. Positions are `StoryRange`s: a paragraph
 * index and a character offset (../text/ops.ts).
 */
import type { Id } from '../ids';
import {
  applyCharacterStyleInDoc,
  clearCharacterOverridesInDoc,
  clearParagraphOverridesInDoc,
  patchCharacterOverridesInDoc,
  patchParagraphOverridesInDoc,
  setParagraphStyleInDoc,
  TextRangeError,
  type OverridePatch,
  type StoryRange,
} from '../text/ops';
import type { CharacterOverrides, ParagraphOverrides } from '../text/props';
import type { PMNode } from '../text/pm';
import { NONE_CHARACTER_ID } from '../text/styles';
import { normalizeStoryDoc, storyDocProblem, storyDocReferenceProblem, type Story } from '../text/story';
import { defineCommand, fail, type DocDraft } from './types';
import { baseOf, own, storyOf } from './util';

/**
 * Run a pure edit over a story's document and store the result when it differs. Fails (leaving the document untouched) for a
 * range that does not fit, a result that is not a valid story document, or a dangling reference.
 */
function editStory(d: DocDraft, storyId: Id, edit: (doc: PMNode) => PMNode): void {
  const story = storyOf(d, storyId);
  const current = baseOf(d).stories[storyId]!.doc as PMNode;
  let next: PMNode;
  try {
    next = edit(current);
  } catch (e) {
    if (e instanceof TextRangeError) fail(e.message);
    throw e;
  }
  const problem = storyDocProblem(next) ?? storyDocReferenceProblem(next, d);
  if (problem) fail(`Invalid story: ${problem}`);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  story.doc = own(next) as Story['doc'];
}

/**
 * Replace a story's text. The document is put in canonical form first (`normalizeStoryDoc`), so a ProseMirror view can pass
 * its JSON as it is. Every paragraph style, character style and swatch it names must exist.
 */
export const setStoryDoc = defineCommand<{ storyId: Id; doc: PMNode }>('story.setDoc', 'Edit Text', (d, { storyId, doc }) => {
  editStory(d, storyId, () => normalizeStoryDoc(doc));
});

/** Give the paragraphs the range touches a paragraph style. Local overrides stay unless `clearOverrides` is set. */
export const applyParagraphStyle = defineCommand<{ storyId: Id; range: StoryRange; styleId: Id; clearOverrides?: boolean }>(
  'story.applyParagraphStyle',
  'Apply Paragraph Style',
  (d, { storyId, range, styleId, clearOverrides = false }) => {
    if (!d.paragraphStyles[styleId]) fail(`No paragraph style "${styleId}"`);
    editStory(d, storyId, (doc) => setParagraphStyleInDoc(doc, range, styleId, clearOverrides));
  },
);

/** Apply a character style to the characters in the range, or remove it (`null`, or `[None]`). Local overrides stay. */
export const applyCharacterStyle = defineCommand<{ storyId: Id; range: StoryRange; styleId: Id | null }>(
  'story.applyCharacterStyle',
  'Apply Character Style',
  (d, { storyId, range, styleId }) => {
    if (styleId !== null && styleId !== NONE_CHARACTER_ID && !d.characterStyles[styleId]) fail(`No character style "${styleId}"`);
    editStory(d, storyId, (doc) => applyCharacterStyleInDoc(doc, range, styleId));
  },
);

export type TextOverrideTarget =
  | { target: 'paragraph'; patch: OverridePatch<ParagraphOverrides> }
  | { target: 'character'; patch: OverridePatch<CharacterOverrides> };

/**
 * Set and unset local overrides over a range. `paragraph` changes the paragraph-level overrides of every paragraph the range
 * touches (alignment, indents, size, ...); `character` changes the override mark of the characters in the range (weight, size,
 * color, ...). `set` merges property by property; `unset` names properties to drop, back to the style's value. A property a
 * character cannot have (an indent, say) is rejected.
 */
export const setTextOverrides = defineCommand<{ storyId: Id; range: StoryRange } & TextOverrideTarget>('story.setOverrides', 'Change Text Formatting', (d, args) => {
  for (const paint of [args.patch.set?.shared?.fill]) {
    if (paint && !d.swatches[paint.swatchId]) fail(`No swatch "${paint.swatchId}"`);
  }
  editStory(d, args.storyId, (doc) =>
    args.target === 'paragraph' ? patchParagraphOverridesInDoc(doc, args.range, args.patch) : patchCharacterOverridesInDoc(doc, args.range, args.patch),
  );
});

/**
 * Clear local overrides over a range, the "Clear Overrides" of the Paragraph Styles panel: `paragraph` the paragraph-level
 * ones, `character` the override marks of the characters in the range (character styles stay), `all` both.
 */
export const clearTextOverrides = defineCommand<{ storyId: Id; range: StoryRange; scope: 'paragraph' | 'character' | 'all' }>(
  'story.clearOverrides',
  'Clear Overrides',
  (d, { storyId, range, scope }) => {
    editStory(d, storyId, (doc) => {
      let next = doc;
      if (scope !== 'paragraph') next = clearCharacterOverridesInDoc(next, range);
      if (scope !== 'character') next = clearParagraphOverridesInDoc(next, range);
      return next;
    });
  },
);
