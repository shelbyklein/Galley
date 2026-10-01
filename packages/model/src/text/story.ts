/**
 * Stories: the text of a text frame, as ProseMirror JSON.
 *
 * Phase 1 (this file): one story per text frame. The story is `doc > paragraph* > text*`, with `strong` and `em`
 * marks, plus `defaults`, the one "default paragraph style" every paragraph uses. Phase 2 (lane T, P2-01) owns this
 * folder: it adds paragraph-style references with local overrides, character-style marks, and threads, and migrates
 * `defaults` into a paragraph style with a v1 to v2 migration.
 *
 * The node and mark shapes follow ProseMirror's `Node.toJSON()` exactly, so `schema.nodeFromJSON(story.doc)` works with
 * any ProseMirror schema that has `doc`, `paragraph`, `text`, `strong` and `em` (the threading spike's schema does).
 */
import { z } from 'zod';
import { idSchema, type Id } from '../ids';
import { paint, paintSchema, SWATCH_BLACK } from '../swatch';
import { positiveSchema } from '../units';

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

export interface PMMark {
  type: string;
  attrs?: Record<string, JSONValue>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, JSONValue>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

const attrsSchema = z.record(z.string(), z.json());

const pmMarkSchema: z.ZodType<PMMark> = z.strictObject({
  type: z.string().min(1),
  attrs: attrsSchema.optional(),
}) as z.ZodType<PMMark>;

export const pmNodeSchema: z.ZodType<PMNode> = z.lazy(() =>
  z.strictObject({
    type: z.string().min(1),
    attrs: attrsSchema.optional(),
    content: z.array(pmNodeSchema).optional(),
    marks: z.array(pmMarkSchema).optional(),
    text: z.string().optional(),
  }),
) as z.ZodType<PMNode>;

const V1_MARKS = new Set(['strong', 'em']);

/** Why a document is not a valid Phase 1 story, or null when it is. */
export function storyDocProblem(doc: PMNode): string | null {
  if (doc.type !== 'doc') return `root node must be "doc", got "${doc.type}"`;
  if (!doc.content || doc.content.length === 0) return 'a story needs at least one paragraph';
  for (const [i, p] of doc.content.entries()) {
    if (p.type !== 'paragraph') return `child ${i} of doc must be a paragraph, got "${p.type}"`;
    for (const [j, t] of (p.content ?? []).entries()) {
      if (t.type !== 'text') return `paragraph ${i} child ${j} must be text, got "${t.type}"`;
      if (typeof t.text !== 'string' || t.text.length === 0) return `paragraph ${i} child ${j} has empty text`;
      for (const m of t.marks ?? []) if (!V1_MARKS.has(m.type)) return `unknown mark "${m.type}" in paragraph ${i}`;
    }
  }
  return null;
}

export const storyDocSchema = pmNodeSchema.superRefine((doc, ctx) => {
  const problem = storyDocProblem(doc);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** The default paragraph style of a story: font, size, leading, alignment, color. Points and 1/1000 em. */
export const textAttrsSchema = z.strictObject({
  fontFamily: z.string().min(1),
  /** CSS weight, 1 to 1000 (400 regular, 700 bold, 800 extra bold). */
  fontWeight: z.number().int().min(1).max(1000),
  fontStyle: z.enum(['normal', 'italic']),
  /** Points. */
  fontSize: positiveSchema,
  /** Fixed line height in points. Multiples of 0.75 pt lay out exactly (see spikes/threading/FINDINGS.md). */
  leading: positiveSchema,
  /** Letter spacing in thousandths of an em (InDesign tracking units). */
  tracking: z.number(),
  align: z.enum(['left', 'center', 'right', 'justify']),
  fill: paintSchema,
});
export type TextAttrs = z.infer<typeof textAttrsSchema>;

export function defaultTextAttrs(): TextAttrs {
  return {
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSize: 12,
    leading: 15,
    tracking: 0,
    align: 'left',
    fill: paint(SWATCH_BLACK),
  };
}

export const storySchema = z.strictObject({
  id: idSchema,
  defaults: textAttrsSchema,
  doc: storyDocSchema,
});
export type Story = z.infer<typeof storySchema>;

/** A `strong`/`em` run, or plain when `marks` is empty. */
export function textNode(text: string, marks: readonly ('strong' | 'em')[] = []): PMNode {
  return marks.length > 0 ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text };
}

export function paragraphNode(...runs: (string | PMNode)[]): PMNode {
  const content = runs.map((r) => (typeof r === 'string' ? textNode(r) : r)).filter((n) => n.text !== '');
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** A story document from plain text: one paragraph per line. */
export function storyDocFromText(text: string): PMNode {
  return { type: 'doc', content: text.split('\n').map((line) => paragraphNode(line)) };
}

export function createStory(id: Id, text: string, defaults: Partial<TextAttrs> = {}): Story {
  return { id, defaults: { ...defaultTextAttrs(), ...defaults }, doc: storyDocFromText(text) };
}

/** The story's text with paragraphs joined by newlines. */
export function storyPlainText(doc: PMNode): string {
  return (doc.content ?? []).map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
}
