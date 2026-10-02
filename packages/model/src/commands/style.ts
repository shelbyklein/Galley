/**
 * Commands on style definitions (paragraph styles and character styles share them; `kind` says which table). A style is
 * `{ id, name, basedOn, shared, print, web }` (../text/styles.ts). The built-ins `[Basic Paragraph]` and `[None]` can be
 * neither deleted nor renamed, and `[None]` cannot be edited at all.
 */
import type { Id } from '../ids';
import { mapDocStyleRefs } from '../text/ops';
import type { PMNode } from '../text/pm';
import { mergeLayers } from '../text/props';
import {
  BASIC_PARAGRAPH_ID,
  basedOnProblem,
  characterStyleSchema,
  isBuiltinCharacterStyle,
  isBuiltinParagraphStyle,
  NONE_CHARACTER_ID,
  paragraphStyleSchema,
  type CharacterStyle,
  type ParagraphStyle,
  type StyleKind,
} from '../text/styles';
import { defineCommand, fail, type DocDraft } from './types';
import { baseOf, insertAt, own, removeFrom } from './util';

export type StyleArgs = { kind: 'paragraph'; style: ParagraphStyle } | { kind: 'character'; style: CharacterStyle };

type AnyStyle = ParagraphStyle | CharacterStyle;
interface Table {
  styles: Record<Id, AnyStyle>;
  order: Id[];
  label: string;
}

function tableOf(d: DocDraft, kind: StyleKind): Table {
  return kind === 'paragraph'
    ? { styles: d.paragraphStyles as Record<Id, AnyStyle>, order: d.paragraphStyleOrder, label: 'paragraph style' }
    : { styles: d.characterStyles as Record<Id, AnyStyle>, order: d.characterStyleOrder, label: 'character style' };
}

const isBuiltin = (kind: StyleKind, id: Id) => (kind === 'paragraph' ? isBuiltinParagraphStyle(id) : isBuiltinCharacterStyle(id));

/** The problems with a style definition, as a message, or null. Checks the shape, the name, the base and the swatch the color uses. */
function styleProblem(d: DocDraft, args: StyleArgs, existing: boolean): string | null {
  const parsed = (args.kind === 'paragraph' ? paragraphStyleSchema : characterStyleSchema).safeParse(args.style);
  if (!parsed.success) return `Invalid style: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  const { styles, label } = tableOf(d, args.kind);
  const { style } = args;
  if ((styles[style.id] !== undefined) !== existing) return existing ? `No ${label} "${style.id}"` : `The ${label} "${style.id}" already exists`;
  for (const other of Object.values(styles)) {
    if (other.id !== style.id && other.name === style.name) return `A ${label} named "${style.name}" already exists`;
  }
  const fill = style.shared.fill;
  if (fill && !d.swatches[fill.swatchId]) return `No swatch "${fill.swatchId}"`;
  if (style.basedOn !== null && !styles[style.basedOn]) return `No ${label} "${style.basedOn}"`;
  return basedOnProblem(styles, style, label);
}

/** Add a style. `index` is its position in the styles panel; default the end. It cannot reuse a built-in's id or any name in use. */
export const addStyle = defineCommand<StyleArgs & { index?: number }>('style.add', 'New Style', (d, args) => {
  const problem = styleProblem(d, args, false);
  if (problem) fail(problem);
  const { styles, order } = tableOf(d, args.kind);
  insertAt(order, args.style.id, args.index);
  styles[args.style.id] = own(args.style);
});

/**
 * Replace a style's definition: its name, base and the three layers (the Paragraph Styles panel's New / Edit / Redefine).
 * Every paragraph or run that uses it, or a style based on it, updates by itself, because they refer to it by id. A `basedOn`
 * that would close a cycle is rejected. `[Basic Paragraph]` keeps its name and has no base; `[None]` cannot change.
 */
export const setStyle = defineCommand<StyleArgs>('style.set', 'Edit Style', (d, args) => {
  const { styles } = tableOf(d, args.kind);
  const current = styles[args.style.id];
  if (!current) fail(`No ${tableOf(d, args.kind).label} "${args.style.id}"`);
  if (args.kind === 'character' && args.style.id === NONE_CHARACTER_ID) fail('The built-in character style [None] cannot be edited');
  if (isBuiltin(args.kind, args.style.id) && (args.style.name !== current.name || args.style.basedOn !== null)) {
    fail(`The built-in style "${current.name}" cannot be renamed or based on another style`);
  }
  const problem = styleProblem(d, args, true);
  if (problem) fail(problem);
  styles[args.style.id] = own(args.style);
});

/** Move a style in the styles panel order. */
export const moveStyle = defineCommand<{ kind: StyleKind; id: Id; index: number }>('style.move', 'Move Style', (d, { kind, id, index }) => {
  const { styles, order, label } = tableOf(d, kind);
  if (!styles[id]) fail(`No ${label} "${id}"`);
  if (!Number.isInteger(index) || index < 0 || index >= order.length) fail(`Index ${String(index)} is out of range`);
  removeFrom(order, id);
  order.splice(index, 0, id);
});

/**
 * Delete a style. Text that used it switches to `replacementId`: for a paragraph style the default is [Basic Paragraph], for a
 * character style `null` (the default) removes the character style from the runs. Local overrides stay. Styles that were based
 * on it keep the way they look: each takes over what the deleted style set and is rebased onto its base. Built-ins stay.
 */
export const removeStyle = defineCommand<{ kind: StyleKind; id: Id; replacementId?: Id | null }>('style.remove', 'Delete Style', (d, { kind, id, replacementId }) => {
  const { styles, order, label } = tableOf(d, kind);
  const doomed = styles[id];
  if (!doomed) fail(`No ${label} "${id}"`);
  if (isBuiltin(kind, id)) fail(`The built-in ${label} "${doomed.name}" cannot be deleted`);
  let replacement = replacementId === undefined ? (kind === 'paragraph' ? BASIC_PARAGRAPH_ID : null) : replacementId;
  if (kind === 'character' && replacement === NONE_CHARACTER_ID) replacement = null; // [None] is no mark
  if (replacement !== null) {
    if (replacement === id) fail('The replacement style is the one being deleted');
    if (!styles[replacement]) fail(`No ${label} "${replacement}"`);
  } else if (kind === 'paragraph') {
    fail('Paragraphs need a style: name a replacement');
  }

  const base = baseOf(d);
  const baseStyles = (kind === 'paragraph' ? base.paragraphStyles : base.characterStyles) as Record<Id, AnyStyle>;
  const baseDoomed = baseStyles[id]!;
  for (const before of Object.values(baseStyles)) {
    if (before.basedOn !== id) continue;
    const folded = mergeLayers(
      { shared: baseDoomed.shared, print: baseDoomed.print, web: baseDoomed.web },
      { shared: before.shared, print: before.print, web: before.web },
    );
    const child = styles[before.id]!;
    child.shared = own(folded.shared) as typeof child.shared;
    child.print = own(folded.print) as typeof child.print;
    child.web = own(folded.web) as typeof child.web;
    child.basedOn = baseDoomed.basedOn;
  }

  for (const story of Object.values(d.stories)) {
    const doc = base.stories[story.id]!.doc as PMNode;
    const next = mapDocStyleRefs(doc, kind, (style) => (style === id ? replacement : style));
    if (next !== doc) story.doc = own(next) as typeof story.doc;
  }
  removeFrom(order, id);
  delete styles[id];
});
