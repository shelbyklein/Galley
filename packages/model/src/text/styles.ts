/**
 * Paragraph styles and character styles: the definitions, the built-in ones, `basedOn` chains and the resolved-style
 * functions the renderer and the thread engine call.
 *
 *   paragraph style   `{ id, name, basedOn, shared, print, web }`. Every paragraph of a story refers to one by id. The
 *                     built-in `[Basic Paragraph]` (`basic-paragraph`) holds every shared and print property explicitly; it
 *                     cannot be deleted or renamed and has no base. A style based on nothing (`basedOn: null`) starts from
 *                     the same constants (BASIC_PARAGRAPH_PROPS), so an unset property always resolves.
 *   character style   the same, restricted to the properties that can vary inside a line (shared: all but the role; print:
 *                     size, leading, baseline shift). The built-in `[None]` (`none`) sets nothing and is read-only; "no
 *                     character style" is the absence of the mark, never a mark pointing at `none`.
 *
 * Resolution order, lowest to highest priority:
 *   paragraph:  constants, the style chain from its root to the style itself, the paragraph's local overrides
 *   run:        the resolved paragraph, the run's character style chain from its root, the run's local override mark
 * `basedOn` chains must end (no cycles); `styleChain` and the validator reject a cycle.
 */
import { z } from 'zod';
import { idSchema, type Id } from '../ids';
import {
  BASIC_PARAGRAPH_PROPS,
  basicParagraphLayers,
  mergeLayerProps,
  sharedCharPropsSchema,
  sharedParaPropsSchema,
  printCharPropsSchema,
  printParaPropsSchema,
  webPropsSchema,
  type CharacterOverrides,
  type ParagraphOverrides,
  type ResolvedParagraph,
} from './props';
import type { PMMark } from './pm';

export const BASIC_PARAGRAPH_ID: Id = 'basic-paragraph';
export const NONE_CHARACTER_ID: Id = 'none';
export const BASIC_PARAGRAPH_NAME = '[Basic Paragraph]';
export const NONE_CHARACTER_NAME = '[None]';

const styleBase = { id: idSchema, name: z.string().trim().min(1), basedOn: idSchema.nullable() };

export const paragraphStyleSchema = z.strictObject({ ...styleBase, shared: sharedParaPropsSchema, print: printParaPropsSchema, web: webPropsSchema });
export const characterStyleSchema = z.strictObject({ ...styleBase, shared: sharedCharPropsSchema, print: printCharPropsSchema, web: webPropsSchema });
export type ParagraphStyle = z.infer<typeof paragraphStyleSchema>;
export type CharacterStyle = z.infer<typeof characterStyleSchema>;
export type StyleKind = 'paragraph' | 'character';

export const isBuiltinParagraphStyle = (id: Id): boolean => id === BASIC_PARAGRAPH_ID;
export const isBuiltinCharacterStyle = (id: Id): boolean => id === NONE_CHARACTER_ID;

/** The built-in paragraph styles every document has, in panel order. */
export function builtinParagraphStyles(): Record<Id, ParagraphStyle> {
  return { [BASIC_PARAGRAPH_ID]: { id: BASIC_PARAGRAPH_ID, name: BASIC_PARAGRAPH_NAME, basedOn: null, ...basicParagraphLayers() } };
}
/** The built-in character styles every document has, in panel order. */
export function builtinCharacterStyles(): Record<Id, CharacterStyle> {
  return { [NONE_CHARACTER_ID]: { id: NONE_CHARACTER_ID, name: NONE_CHARACTER_NAME, basedOn: null, shared: {}, print: {}, web: {} } };
}

/** The style tables resolution reads; a whole document satisfies it. */
export interface StyleTables {
  readonly paragraphStyles: Readonly<Record<Id, ParagraphStyle>>;
  readonly characterStyles: Readonly<Record<Id, CharacterStyle>>;
}

// ------------------------------------------------------------------------------------------------------------ chains

export class StyleChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleChainError';
  }
}

/** The style and everything it is based on, root first and the style itself last. Throws on a missing style or a cycle. */
export function styleChain<S extends { id: Id; basedOn: Id | null }>(table: Readonly<Record<Id, S>>, id: Id, what = 'style'): S[] {
  const chain: S[] = [];
  const seen = new Set<Id>();
  let at: Id | null = id;
  while (at !== null) {
    if (seen.has(at)) throw new StyleChainError(`The ${what} "${at}" is based on itself (a cycle in its basedOn chain)`);
    seen.add(at);
    const s: S | undefined = table[at];
    if (!s) throw new StyleChainError(`No ${what} "${at}"`);
    chain.push(s);
    at = s.basedOn;
  }
  return chain.reverse();
}

/**
 * The first problem in the `basedOn` chain starting at `id` when `candidate` is stored under `id` instead of what the table
 * holds, as a message, or null when the chain ends cleanly. Commands use it to refuse a change that would close a cycle.
 */
export function basedOnProblem<S extends { id: Id; basedOn: Id | null }>(table: Readonly<Record<Id, S>>, candidate: S, what: string): string | null {
  const seen = new Set<Id>([candidate.id]);
  let at: Id | null = candidate.basedOn;
  while (at !== null) {
    if (seen.has(at)) return `That would make the ${what} "${candidate.id}" based on itself`;
    seen.add(at);
    const s: S | undefined = table[at];
    if (!s) return `No ${what} "${at}"`;
    at = s.basedOn;
  }
  return null;
}

// -------------------------------------------------------------------------------------------------------- resolving

type Layers = { shared?: object; print?: object; web?: object };

/** Apply layers on top of a resolved paragraph. `web` is left alone for runs (a character style has no web say in print). */
function apply(base: ResolvedParagraph, layers: Layers | undefined, withWeb: boolean): ResolvedParagraph {
  if (!layers) return base;
  const { web, ...flat } = base;
  const merged = mergeLayerProps(mergeLayerProps(flat as Record<string, unknown>, layers.shared as Record<string, unknown> | undefined), layers.print as Record<string, unknown> | undefined);
  return { ...(merged as Omit<ResolvedParagraph, 'web'>), web: withWeb ? mergeLayerProps(web, layers.web as typeof web | undefined) : web };
}

const paragraphCache = new WeakMap<object, Map<Id, ResolvedParagraph>>();

/** A paragraph style with its whole chain resolved: every property set. Results are shared and cached; do not mutate them. */
export function resolveParagraphStyle(tables: Pick<StyleTables, 'paragraphStyles'>, styleId: Id): ResolvedParagraph {
  let byId = paragraphCache.get(tables.paragraphStyles);
  if (!byId) {
    byId = new Map();
    paragraphCache.set(tables.paragraphStyles, byId);
  }
  const hit = byId.get(styleId);
  if (hit) return hit;
  let resolved: ResolvedParagraph = BASIC_PARAGRAPH_PROPS;
  for (const style of styleChain(tables.paragraphStyles, styleId, 'paragraph style')) resolved = apply(resolved, style, true);
  byId.set(styleId, resolved);
  return resolved;
}

/** What a paragraph node's attributes say: its style and its local overrides. */
export interface ParagraphAttrs {
  style: Id;
  overrides?: ParagraphOverrides;
}

/** The effective properties of a paragraph: its style chain, then its local overrides. */
export function resolveParagraph(tables: Pick<StyleTables, 'paragraphStyles'>, attrs: ParagraphAttrs): ResolvedParagraph {
  const base = resolveParagraphStyle(tables, attrs.style);
  return attrs.overrides ? apply(base, attrs.overrides, true) : base;
}

/** A character style chain resolved on top of a paragraph: the character-eligible properties it sets replace the paragraph's. */
export function resolveCharacterStyle(tables: Pick<StyleTables, 'characterStyles'>, paragraph: ResolvedParagraph, styleId: Id): ResolvedParagraph {
  let resolved = paragraph;
  for (const style of styleChain(tables.characterStyles, styleId, 'character style')) resolved = apply(resolved, style, false);
  return resolved;
}

/** The marks of a run, as the resolver reads them: at most a `charStyle` and an `override`. */
export function runMarks(marks: readonly PMMark[] | undefined): { style: Id | null; overrides: CharacterOverrides | null } {
  let style: Id | null = null;
  let overrides: CharacterOverrides | null = null;
  for (const m of marks ?? []) {
    if (m.type === 'charStyle') style = (m.attrs?.style as string | undefined) ?? null;
    else if (m.type === 'override') overrides = (m.attrs ?? null) as CharacterOverrides | null;
  }
  return { style, overrides };
}

/**
 * The effective properties of a run of text: the resolved paragraph, then the run's character style chain, then its local
 * override mark. A run with no marks is the paragraph itself (the same object).
 */
export function resolveRun(tables: Pick<StyleTables, 'characterStyles'>, paragraph: ResolvedParagraph, marks: readonly PMMark[] | undefined): ResolvedParagraph {
  const { style, overrides } = runMarks(marks);
  let resolved = paragraph;
  if (style !== null && style !== NONE_CHARACTER_ID) resolved = resolveCharacterStyle(tables, resolved, style);
  if (overrides) resolved = apply(resolved, overrides, false);
  return resolved;
}

/** Whether the paragraph has local overrides (what the Paragraph Styles panel marks with `+`). */
export function hasParagraphOverrides(attrs: ParagraphAttrs): boolean {
  return attrs.overrides !== undefined && Object.keys(attrs.overrides).length > 0;
}

