/**
 * Stories: the text of one thread of text frames, as ProseMirror JSON (`formatVersion: 2`). See TEXT-MODEL.md for the whole
 * text model; this file is the story shape.
 *
 *   story   `{ id, frameIds, doc }`. `frameIds` is the thread: the story's text frames in reading order (one frame for an
 *           unthreaded story). Each of those frames has `storyId` pointing back. `doc` is the source of truth for the text;
 *           frames are windows onto it (the thread engine, lane T's P2-02, decides where each window starts and ends).
 *   doc     `doc > paragraph+`; a paragraph holds `text` nodes only.
 *   paragraph   attrs `{ style, overrides? }`: the id of a paragraph style, and the local overrides (the three style layers,
 *           each optional, holding only what differs from the style).
 *   text    `{ type: 'text', text, marks? }` with at most two marks, in this order:
 *             `charStyle`  attrs `{ style }`: a character style by id (no mark at all is [None])
 *             `override`   attrs: the same layers as paragraph overrides, restricted to what a character may change
 *
 * v1 had `strong` and `em` marks and a `defaults` object per story. The v1 to v2 migration (../migrate/v1.ts) turns the
 * defaults into a paragraph style and each strong / em run into an `override` mark with an explicit weight / italic.
 *
 * The node and mark shapes follow ProseMirror's `Node.toJSON()`, so `schema.nodeFromJSON(story.doc)` works with a schema
 * that declares `paragraph` (attrs `style`, `overrides`) and the two marks. ProseMirror writes default attrs as `null` and
 * view-only attrs too; run `normalizeStoryDoc` on its JSON before storing it, which is the canonical form the validator wants.
 */
import { z } from 'zod';
import { idSchema, type Id } from '../ids';
import { characterOverridesSchema, compactLayers, layersAreEmpty, paragraphOverridesSchema, type CharacterOverrides, type ParagraphOverrides } from './props';
import type { PMMark, PMNode } from './pm';
import { BASIC_PARAGRAPH_ID, NONE_CHARACTER_ID, type ParagraphAttrs } from './styles';

export const MARK_ORDER = ['charStyle', 'override'] as const;

const charStyleMarkSchema = z.strictObject({ type: z.literal('charStyle'), attrs: z.strictObject({ style: idSchema }) });
const overrideMarkSchema = z.strictObject({ type: z.literal('override'), attrs: characterOverridesSchema });
const textNodeSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(z.discriminatedUnion('type', [charStyleMarkSchema, overrideMarkSchema])).min(1).optional(),
});
const paragraphNodeSchema = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z.strictObject({ style: idSchema, overrides: paragraphOverridesSchema.optional() }),
  content: z.array(textNodeSchema).min(1).optional(),
});

/** The shape of a story document. A node with no content is an empty paragraph; an empty text node or empty marks list is not allowed. */
export const storyDocSchema = z
  .strictObject({ type: z.literal('doc'), content: z.array(paragraphNodeSchema).min(1) })
  .superRefine((doc, ctx) => {
    doc.content.forEach((p, i) => {
      if (p.attrs.overrides && layersAreEmpty(p.attrs.overrides)) {
        ctx.addIssue({ code: 'custom', message: `paragraph ${i} has empty overrides; leave them out`, path: ['content', i, 'attrs', 'overrides'] });
      }
      (p.content ?? []).forEach((t, j) => {
        const types = (t.marks ?? []).map((m) => m.type);
        const ranks = types.map((m) => MARK_ORDER.indexOf(m));
        if (ranks.some((r, k) => k > 0 && r <= ranks[k - 1]!)) {
          ctx.addIssue({ code: 'custom', message: `paragraph ${i} run ${j}: marks must be at most one charStyle then one override`, path: ['content', i, 'content', j, 'marks'] });
        }
        for (const m of t.marks ?? []) {
          if (m.type === 'override' && layersAreEmpty(m.attrs)) {
            ctx.addIssue({ code: 'custom', message: `paragraph ${i} run ${j}: an override mark must set something`, path: ['content', i, 'content', j, 'marks'] });
          }
        }
      });
    });
  }) as unknown as z.ZodType<PMNode>;

/** Why a document is not a valid story document, or null when it is. */
export function storyDocProblem(doc: PMNode): string | null {
  const r = storyDocSchema.safeParse(doc);
  if (r.success) return null;
  return r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

export const storySchema = z.strictObject({
  id: idSchema,
  /** The thread: this story's text frames in reading order. At least one in a valid document (the validator checks). */
  frameIds: z.array(idSchema),
  doc: storyDocSchema,
});
export type Story = z.infer<typeof storySchema>;

// ------------------------------------------------------------------------------------------------------- references

export interface StoryRefs {
  paragraphStyles: Readonly<Record<Id, unknown>>;
  characterStyles: Readonly<Record<Id, unknown>>;
  swatches: Readonly<Record<Id, unknown>>;
}

function paintProblems(layers: { shared?: { fill?: { swatchId: string } } } | undefined, refs: StoryRefs, where: string): string | null {
  const fill = layers?.shared?.fill;
  if (fill && !(fill.swatchId in refs.swatches)) return `${where}: swatch "${fill.swatchId}" does not exist`;
  return null;
}

/** Why a (shape-valid) story document points at things that do not exist, or null when every reference resolves. */
export function storyDocReferenceProblem(doc: PMNode, refs: StoryRefs): string | null {
  for (const [i, p] of (doc.content ?? []).entries()) {
    const attrs = paragraphAttrs(p);
    if (!(attrs.style in refs.paragraphStyles)) return `paragraph ${i}: paragraph style "${attrs.style}" does not exist`;
    const overrideProblem = paintProblems(attrs.overrides, refs, `paragraph ${i} overrides`);
    if (overrideProblem) return overrideProblem;
    for (const [j, t] of (p.content ?? []).entries()) {
      for (const m of t.marks ?? []) {
        if (m.type === 'charStyle') {
          const style = m.attrs?.style as string;
          if (style === NONE_CHARACTER_ID) return `paragraph ${i} run ${j}: [None] is the absence of a charStyle mark, not a mark`;
          if (!(style in refs.characterStyles)) return `paragraph ${i} run ${j}: character style "${style}" does not exist`;
        } else if (m.type === 'override') {
          const markProblem = paintProblems(m.attrs as { shared?: { fill?: { swatchId: string } } }, refs, `paragraph ${i} run ${j} override`);
          if (markProblem) return markProblem;
        }
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------------------------------------------------- nodes

/** A paragraph node's attributes, as the resolver reads them (a node without attrs is the basic paragraph). */
export function paragraphAttrs(p: PMNode): ParagraphAttrs {
  const a = p.attrs as { style?: string; overrides?: ParagraphOverrides | null } | undefined;
  return { style: a?.style ?? BASIC_PARAGRAPH_ID, ...(a?.overrides ? { overrides: a.overrides } : {}) };
}

export function charStyleMark(style: Id): PMMark {
  return { type: 'charStyle', attrs: { style } };
}

/** An `override` mark carrying local character formatting (shared and print layers; web is allowed but unused in print). */
export function overrideMark(overrides: CharacterOverrides): PMMark {
  return { type: 'override', attrs: compactLayers(overrides) as unknown as PMMark['attrs'] };
}

/** A run of text with these marks (none: plain). Marks are put in canonical order. */
export function textNode(text: string, marks: readonly PMMark[] = []): PMNode {
  const sorted = [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type as 'charStyle') - MARK_ORDER.indexOf(b.type as 'charStyle'));
  return sorted.length > 0 ? { type: 'text', text, marks: sorted } : { type: 'text', text };
}

/** A paragraph in a style (default `[Basic Paragraph]`), with optional local overrides, from runs (strings are plain text). Empty runs are dropped. */
export function styledParagraph(attrs: ParagraphAttrs, ...runs: (string | PMNode)[]): PMNode {
  const content = runs.map((r) => (typeof r === 'string' ? textNode(r) : r)).filter((n) => n.text !== '');
  const a: Record<string, unknown> = { style: attrs.style };
  if (attrs.overrides && !layersAreEmpty(attrs.overrides)) a.overrides = compactLayers(attrs.overrides);
  const node: PMNode = { type: 'paragraph', attrs: a as PMNode['attrs'] };
  if (content.length > 0) node.content = content;
  return node;
}

/** A `[Basic Paragraph]` paragraph from runs. */
export function paragraphNode(...runs: (string | PMNode)[]): PMNode {
  return styledParagraph({ style: BASIC_PARAGRAPH_ID }, ...runs);
}

/** A story document from plain text: one paragraph per line, all in one style. */
export function storyDocFromText(text: string, attrs: ParagraphAttrs = { style: BASIC_PARAGRAPH_ID }): PMNode {
  return { type: 'doc', content: text.split('\n').map((line) => styledParagraph(attrs, line)) };
}

export interface CreateStoryOptions {
  /** The paragraph style of every paragraph; default `[Basic Paragraph]`. */
  style?: Id;
  /** Local paragraph overrides on every paragraph. */
  overrides?: ParagraphOverrides;
  /** The thread. Leave it out when adding the story with its first frame (`frame.add` fills it in). */
  frameIds?: Id[];
}

export function createStory(id: Id, text: string, options: CreateStoryOptions = {}): Story {
  return {
    id,
    frameIds: options.frameIds ? [...options.frameIds] : [],
    doc: storyDocFromText(text, { style: options.style ?? BASIC_PARAGRAPH_ID, ...(options.overrides ? { overrides: options.overrides } : {}) }) as Story['doc'],
  };
}

/** The text of one paragraph node. */
export function paragraphText(p: PMNode): string {
  return (p.content ?? []).map((t) => t.text ?? '').join('');
}

/** The story's text with paragraphs joined by newlines. */
export function storyPlainText(doc: PMNode): string {
  return (doc.content ?? []).map(paragraphText).join('\n');
}

/** True when the story holds no characters at all. */
export function storyIsEmpty(doc: PMNode): boolean {
  return (doc.content ?? []).every((p) => paragraphText(p) === '');
}

// ---------------------------------------------------------------------------------------------------- normalization

const marksKey = (marks: readonly PMMark[] | undefined) => JSON.stringify(marks ?? []);

/**
 * The canonical form of a story document, which is what the validator accepts and what the model stores: paragraphs carry
 * exactly `style` and non-empty `overrides` (ProseMirror's `null` and view-only attributes are dropped), text nodes are
 * non-empty with marks in canonical order, empty override marks are gone, and neighbouring runs with equal marks are merged.
 * Does not check references; see `storyDocReferenceProblem`.
 */
export function normalizeStoryDoc(doc: PMNode): PMNode {
  if (doc.type !== 'doc') return doc;
  const paragraphs = (doc.content ?? []).map((p): PMNode => {
    if (p.type !== 'paragraph') return p; // not ours to fix: the schema rejects it
    const attrs = paragraphAttrs(p);
    const runs: PMNode[] = [];
    for (const t of p.content ?? []) {
      if (t.type !== 'text') {
        runs.push(t);
        continue;
      }
      if (typeof t.text !== 'string' || t.text === '') continue;
      const marks: PMMark[] = [];
      for (const type of MARK_ORDER) {
        const m = (t.marks ?? []).find((x) => x.type === type);
        if (!m) continue;
        if (type === 'override') {
          const attrsCompact = compactLayers((m.attrs ?? {}) as CharacterOverrides);
          if (!layersAreEmpty(attrsCompact)) marks.push({ type, attrs: attrsCompact as unknown as PMMark['attrs'] });
        } else marks.push({ type, attrs: { style: m.attrs?.style as string } });
      }
      const last = runs[runs.length - 1];
      if (last && last.type === 'text' && marksKey(last.marks) === marksKey(marks)) last.text = (last.text ?? '') + t.text;
      else runs.push(marks.length > 0 ? { type: 'text', text: t.text, marks } : { type: 'text', text: t.text });
    }
    return styledParagraph(attrs, ...runs);
  });
  return { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [paragraphNode()] };
}
