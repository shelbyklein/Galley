/**
 * Pure edits of a story document: apply a paragraph style, apply a character style, set and clear local overrides over a
 * range. They take and return plain ProseMirror JSON (never mutating the input), and the result is in canonical form
 * (`normalizeStoryDoc`). The `story.*` commands wrap them with validation; lane T's editor can call them directly.
 *
 * Positions are the model's own, so no ProseMirror is needed: a point is a paragraph index and a character offset in that
 * paragraph's text (UTF-16 code units, the same as JavaScript string offsets). A range runs from `from` to `to`, both
 * inclusive of the characters between them; a collapsed range (`from` equal to `to`) formats no characters. Paragraph-level
 * operations affect every paragraph the range touches, collapsed or not.
 */
import { mergeLayerProps, compactLayers, layersAreEmpty, type CharacterOverrides, type LayerName, type ParagraphOverrides, LAYER_NAMES } from './props';
import type { PMMark, PMNode } from './pm';
import { MARK_ORDER, normalizeStoryDoc, paragraphAttrs, paragraphText } from './story';
import { NONE_CHARACTER_ID } from './styles';
import type { Id } from '../ids';
import type { Paint } from '../swatch';

export interface StoryPoint {
  paragraph: number;
  offset: number;
}
export interface StoryRange {
  from: StoryPoint;
  to: StoryPoint;
}

/** A range that does not fit the document. */
export class TextRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextRangeError';
  }
}

/** The start and end of a range in document order, checked against the document. */
export function orderRange(doc: PMNode, range: StoryRange): StoryRange {
  const paragraphs = doc.content ?? [];
  for (const [name, pt] of [
    ['from', range.from],
    ['to', range.to],
  ] as const) {
    if (!Number.isInteger(pt.paragraph) || pt.paragraph < 0 || pt.paragraph >= paragraphs.length) {
      throw new TextRangeError(`${name}.paragraph ${String(pt.paragraph)} is out of range 0..${paragraphs.length - 1}`);
    }
    const length = paragraphText(paragraphs[pt.paragraph]!).length;
    if (!Number.isInteger(pt.offset) || pt.offset < 0 || pt.offset > length) {
      throw new TextRangeError(`${name}.offset ${String(pt.offset)} is out of range 0..${length} in paragraph ${pt.paragraph}`);
    }
  }
  const before = range.from.paragraph < range.to.paragraph || (range.from.paragraph === range.to.paragraph && range.from.offset <= range.to.offset);
  return before ? range : { from: range.to, to: range.from };
}

/** The range that covers a whole story. */
export function wholeStory(doc: PMNode): StoryRange {
  const paragraphs = doc.content ?? [];
  const last = paragraphs.length - 1;
  return { from: { paragraph: 0, offset: 0 }, to: { paragraph: last, offset: paragraphText(paragraphs[last]!).length } };
}

/** What to change in a set of override layers: properties to set, and property names to remove (back to the style's value). */
export interface OverridePatch<O> {
  set?: O;
  unset?: Partial<Record<LayerName, readonly string[]>>;
}

/** Apply a patch to override layers. Returns the new layers, or undefined when nothing is left. */
export function patchOverrides<O extends { shared?: object; print?: object; web?: object }>(current: O | undefined, patch: OverridePatch<O>): O | undefined {
  const next: Record<string, Record<string, unknown>> = {};
  for (const name of LAYER_NAMES) {
    let part: Record<string, unknown> = { ...((current?.[name] as Record<string, unknown> | undefined) ?? {}) };
    part = mergeLayerProps(part, patch.set?.[name] as Record<string, unknown> | undefined);
    for (const key of patch.unset?.[name] ?? []) delete part[key];
    next[name] = part;
  }
  const compact = compactLayers(next as O);
  return layersAreEmpty(compact) ? undefined : compact;
}

// -------------------------------------------------------------------------------------------------------- paragraphs

function mapParagraphs(doc: PMNode, range: StoryRange, fn: (p: PMNode) => PMNode): PMNode {
  const { from, to } = orderRange(doc, range);
  const content = (doc.content ?? []).map((p, i) => (i >= from.paragraph && i <= to.paragraph ? fn(p) : p));
  return normalizeStoryDoc({ ...doc, content });
}

const withAttrs = (p: PMNode, style: Id, overrides: ParagraphOverrides | undefined): PMNode => {
  const attrs: Record<string, unknown> = { style };
  if (overrides) attrs.overrides = overrides;
  return { ...p, attrs: attrs as PMNode['attrs'] };
};

/** Give every paragraph the range touches this paragraph style; optionally drop their local overrides. */
export function setParagraphStyleInDoc(doc: PMNode, range: StoryRange, styleId: Id, clearOverrides = false): PMNode {
  return mapParagraphs(doc, range, (p) => withAttrs(p, styleId, clearOverrides ? undefined : paragraphAttrs(p).overrides));
}

/** Set and unset paragraph-level overrides on every paragraph the range touches. */
export function patchParagraphOverridesInDoc(doc: PMNode, range: StoryRange, patch: OverridePatch<ParagraphOverrides>): PMNode {
  return mapParagraphs(doc, range, (p) => {
    const a = paragraphAttrs(p);
    return withAttrs(p, a.style, patchOverrides(a.overrides, patch));
  });
}

/** Remove the local overrides of every paragraph the range touches. */
export function clearParagraphOverridesInDoc(doc: PMNode, range: StoryRange): PMNode {
  return mapParagraphs(doc, range, (p) => withAttrs(p, paragraphAttrs(p).style, undefined));
}

// ------------------------------------------------------------------------------------------------------------ runs

/** Split a paragraph's runs at `start` and `end` and replace the marks of the part between them. */
function mapRuns(p: PMNode, start: number, end: number, fn: (marks: PMMark[]) => PMMark[]): PMNode {
  const out: PMNode[] = [];
  let pos = 0;
  for (const run of p.content ?? []) {
    const text = run.text ?? '';
    const runStart = pos;
    const runEnd = pos + text.length;
    pos = runEnd;
    const a = Math.max(start, runStart);
    const b = Math.min(end, runEnd);
    if (b <= a) {
      out.push(run);
      continue;
    }
    const piece = (from: number, to: number, marks: PMMark[] | undefined): PMNode => {
      const t = text.slice(from - runStart, to - runStart);
      return marks && marks.length > 0 ? { type: 'text', text: t, marks } : { type: 'text', text: t };
    };
    if (a > runStart) out.push(piece(runStart, a, run.marks));
    out.push(piece(a, b, fn([...(run.marks ?? [])])));
    if (b < runEnd) out.push(piece(b, runEnd, run.marks));
  }
  const { content: _old, ...rest } = p;
  return out.length > 0 ? { ...rest, content: out } : rest;
}

function mapRange(doc: PMNode, range: StoryRange, fn: (marks: PMMark[]) => PMMark[]): PMNode {
  const { from, to } = orderRange(doc, range);
  const content = (doc.content ?? []).map((p, i) => {
    if (i < from.paragraph || i > to.paragraph) return p;
    const length = paragraphText(p).length;
    return mapRuns(p, i === from.paragraph ? from.offset : 0, i === to.paragraph ? to.offset : length, fn);
  });
  return normalizeStoryDoc({ ...doc, content });
}

const without = (marks: PMMark[], type: (typeof MARK_ORDER)[number]) => marks.filter((m) => m.type !== type);

/** Apply a character style to the characters in the range; `null` (or `[None]`) removes the character style. Local overrides stay. */
export function applyCharacterStyleInDoc(doc: PMNode, range: StoryRange, styleId: Id | null): PMNode {
  return mapRange(doc, range, (marks) => {
    const rest = without(marks, 'charStyle');
    return styleId === null || styleId === NONE_CHARACTER_ID ? rest : [{ type: 'charStyle', attrs: { style: styleId } }, ...rest];
  });
}

/** Set and unset character-level overrides on the characters in the range. */
export function patchCharacterOverridesInDoc(doc: PMNode, range: StoryRange, patch: OverridePatch<CharacterOverrides>): PMNode {
  return mapRange(doc, range, (marks) => {
    const current = marks.find((m) => m.type === 'override')?.attrs as CharacterOverrides | undefined;
    const next = patchOverrides(current, patch);
    const rest = without(marks, 'override');
    return next ? [...rest, { type: 'override', attrs: next as unknown as PMMark['attrs'] }] : rest;
  });
}

/** Remove the character-level overrides of the characters in the range (their character styles stay). */
export function clearCharacterOverridesInDoc(doc: PMNode, range: StoryRange): PMNode {
  return mapRange(doc, range, (marks) => without(marks, 'override'));
}

// ------------------------------------------------------------------------------------------------------------ paints

/**
 * Rewrite the text colors a story document sets locally (paragraph overrides and override marks). `fn` returns the paint to
 * use instead, or null to drop the local color (the text then inherits). Returns the same object when nothing changed.
 */
export function mapDocFills(doc: PMNode, fn: (fill: Paint) => Paint | null): PMNode {
  let changed = false;
  const fix = <O extends { shared?: { fill?: Paint } }>(overrides: O | undefined): O | undefined => {
    const fill = overrides?.shared?.fill;
    if (!overrides || !fill) return overrides;
    const next = fn(fill);
    if (next === fill) return overrides;
    changed = true;
    const shared: Record<string, unknown> = { ...overrides.shared };
    if (next) shared.fill = next;
    else delete shared.fill;
    return { ...overrides, shared } as O;
  };
  const content = (doc.content ?? []).map((p) => {
    const attrs = paragraphAttrs(p);
    const overrides = fix(attrs.overrides);
    const runs = (p.content ?? []).map((t) => ({
      ...t,
      ...(t.marks
        ? {
            marks: t.marks.map((m) => {
              if (m.type !== 'override') return m;
              const next = fix(m.attrs as CharacterOverrides | undefined);
              return next === m.attrs ? m : { ...m, attrs: next as unknown as PMMark['attrs'] };
            }),
          }
        : {}),
    }));
    return { ...p, attrs: { style: attrs.style, ...(overrides ? { overrides } : {}) } as PMNode['attrs'], ...(runs.length > 0 ? { content: runs } : {}) };
  });
  return changed ? normalizeStoryDoc({ ...doc, content }) : doc;
}

// ------------------------------------------------------------------------------------------------------ style references

/**
 * Rewrite the style ids a story document refers to. For `paragraph`, `fn` maps each paragraph's style id to the id to use. For
 * `character`, `fn` maps a `charStyle` mark's id to a new id, or to null to drop the mark. Returns the same object when
 * nothing changed.
 */
export function mapDocStyleRefs(doc: PMNode, kind: 'paragraph' | 'character', fn: (style: Id) => Id | null): PMNode {
  let changed = false;
  const content = (doc.content ?? []).map((p) => {
    if (kind === 'paragraph') {
      const attrs = paragraphAttrs(p);
      const next = fn(attrs.style);
      if (next === null || next === attrs.style) return p;
      changed = true;
      return { ...p, attrs: { ...p.attrs, style: next } as PMNode['attrs'] };
    }
    const runs = (p.content ?? []).map((t) => {
      const mark = (t.marks ?? []).find((m) => m.type === 'charStyle');
      if (!mark) return t;
      const next = fn(mark.attrs?.style as string);
      if (next === (mark.attrs?.style as string)) return t;
      changed = true;
      const marks = (t.marks ?? []).filter((m) => m.type !== 'charStyle');
      return { ...t, marks: next === null ? marks : [{ type: 'charStyle', attrs: { style: next } }, ...marks] };
    });
    return { ...p, ...(runs.length > 0 ? { content: runs } : {}) };
  });
  return changed ? normalizeStoryDoc({ ...doc, content }) : doc;
}
