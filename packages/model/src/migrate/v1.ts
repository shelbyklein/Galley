/**
 * The v1 to v2 migration (`formatVersion: 1` to `2`), run automatically when a v1 package is opened.
 *
 * v1 stories held a `defaults` object (family, weight, style, size, leading, tracking, alignment, color) and `strong` / `em`
 * runs. v2 stories refer to paragraph styles and carry character marks (../text/story.ts), threads list their frames, and the
 * document has style tables and a baseline grid. The migration keeps what the page looks like exactly:
 *
 *   - Each distinct `defaults` becomes a paragraph style based on [Basic Paragraph], with every v1 property set explicitly, so
 *     later edits to [Basic Paragraph] cannot change an imported document. Stories whose defaults equal [Basic Paragraph]'s
 *     properties simply use it. Styles are created in story id order and named by what they set, for example `Inter ExtraBold
 *     160/168` (a second style with the same name gets ` (2)`).
 *   - Every paragraph gets that style and no overrides.
 *   - A `strong` run becomes an `override` mark with the weight CSS `bolder` gave it (400 to 700, 700 and above to 900), an `em`
 *     run one with `fontStyle: italic`; a run whose override would change nothing (strong over weight 900, em over italic) gets
 *     no mark. Rendering is therefore identical.
 *   - `story.frameIds` is the list of text frames that name the story (one in v1), sorted by id.
 *   - `baselineGrid` is the default (0, 12 pt); frames get no `textWrap`.
 *
 * It works on raw parsed JSON, before schema validation, and is deterministic: the same v1 document always gives the same v2.
 */
import { z } from 'zod';
import { paintSchema } from '../swatch';
import { normalizeStoryDoc } from '../text/story';
import { BASIC_PARAGRAPH_ID, NONE_CHARACTER_ID, builtinCharacterStyles, builtinParagraphStyles, type ParagraphStyle } from '../text/styles';
import { BASIC_PARAGRAPH_PROPS, textAttrsToLayers, type TextAttrs } from '../text/props';
import { positiveSchema } from '../units';
import type { PMMark, PMNode } from '../text/pm';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const v1TextAttrsSchema = z.strictObject({
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(1).max(1000),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: positiveSchema,
  leading: positiveSchema,
  tracking: z.number(),
  align: z.enum(['left', 'center', 'right', 'justify']),
  fill: paintSchema,
});

const v1TextSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(z.strictObject({ type: z.enum(['strong', 'em']), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
});
const v1ParagraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(v1TextSchema).optional(),
});
const v1StorySchema = z.strictObject({
  id: z.string(),
  defaults: v1TextAttrsSchema,
  doc: z.strictObject({ type: z.literal('doc'), content: z.array(v1ParagraphSchema).min(1) }),
});

/** What CSS `font-weight: bolder` makes of an inherited weight (CSS Fonts 4, 2.2.1): 400 below 350, 700 below 550, else 900. */
export function bolderWeight(weight: number): number {
  return weight < 350 ? 400 : weight < 550 ? 700 : 900;
}

const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** `Inter ExtraBold 160/168`, `Inter Regular Italic 12/18`. */
export function describeTextAttrs(a: TextAttrs): string {
  const weight = WEIGHT_NAMES[a.fontWeight] ?? `W${a.fontWeight}`;
  return `${a.fontFamily} ${weight}${a.fontStyle === 'italic' ? ' Italic' : ''} ${fmt(a.fontSize)}/${fmt(a.leading)}`;
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value,
  );

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function convertRun(run: z.infer<typeof v1TextSchema>, base: TextAttrs): PMNode {
  const types = new Set((run.marks ?? []).map((m) => m.type));
  const marks: PMMark[] = [];
  const shared: Record<string, unknown> = {};
  if (types.has('strong') && bolderWeight(base.fontWeight) !== base.fontWeight) shared.fontWeight = bolderWeight(base.fontWeight);
  if (types.has('em') && base.fontStyle !== 'italic') shared.fontStyle = 'italic';
  if (Object.keys(shared).length > 0) marks.push({ type: 'override', attrs: { shared } as PMMark['attrs'] });
  return marks.length > 0 ? { type: 'text', text: run.text, marks } : { type: 'text', text: run.text };
}

/** Upgrade a raw v1 document to v2. Throws `MigrationError` for a story that is not a valid v1 story. */
export function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const rawStories = raw.stories === undefined ? {} : raw.stories;
  if (!isPlainObject(rawStories)) throw new MigrationError('"stories" must be an object');
  const rawFrames = isPlainObject(raw.frames) ? raw.frames : {};

  // the text frames of each story, by frame id
  const framesOf = new Map<string, string[]>();
  for (const [frameId, frame] of Object.entries(rawFrames)) {
    if (isPlainObject(frame) && frame.type === 'text' && typeof frame.storyId === 'string') {
      const list = framesOf.get(frame.storyId) ?? [];
      list.push(frameId);
      framesOf.set(frame.storyId, list);
    }
  }

  const paragraphStyles = builtinParagraphStyles();
  const paragraphStyleOrder = [BASIC_PARAGRAPH_ID];
  const names = new Set(Object.values(paragraphStyles).map((s) => s.name));
  const styleByDefaults = new Map<string, string>();
  const basicKey = canonical(
    v1TextAttrsSchema.parse({
      fontFamily: BASIC_PARAGRAPH_PROPS.fontFamily,
      fontWeight: BASIC_PARAGRAPH_PROPS.fontWeight,
      fontStyle: BASIC_PARAGRAPH_PROPS.fontStyle,
      fontSize: BASIC_PARAGRAPH_PROPS.fontSize,
      leading: BASIC_PARAGRAPH_PROPS.leading,
      tracking: BASIC_PARAGRAPH_PROPS.tracking,
      align: BASIC_PARAGRAPH_PROPS.align,
      fill: BASIC_PARAGRAPH_PROPS.fill,
    }),
  );
  styleByDefaults.set(basicKey, BASIC_PARAGRAPH_ID);

  const stories: Record<string, unknown> = {};
  let imported = 0;
  for (const storyId of Object.keys(rawStories).sort()) {
    const parsed = v1StorySchema.safeParse(rawStories[storyId]);
    if (!parsed.success) {
      throw new MigrationError(`story "${storyId}" is not a valid v1 story: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const { defaults, doc } = parsed.data;
    const key = canonical(defaults);
    let styleId = styleByDefaults.get(key);
    if (!styleId) {
      imported++;
      styleId = `imported-${imported}`;
      let name = describeTextAttrs(defaults);
      for (let n = 2; names.has(name); n++) name = `${describeTextAttrs(defaults)} (${n})`;
      names.add(name);
      const style: ParagraphStyle = { id: styleId, name, basedOn: BASIC_PARAGRAPH_ID, ...structuredClone(textAttrsToLayers(defaults)) };
      paragraphStyles[styleId] = style;
      paragraphStyleOrder.push(styleId);
      styleByDefaults.set(key, styleId);
    }
    const converted: PMNode = {
      type: 'doc',
      content: doc.content.map((p) => ({
        type: 'paragraph',
        attrs: { style: styleId! },
        ...(p.content && p.content.length > 0 ? { content: p.content.map((run) => convertRun(run, defaults)) } : {}),
      })),
    };
    stories[storyId] = { id: parsed.data.id, frameIds: (framesOf.get(storyId) ?? []).sort(), doc: normalizeStoryDoc(converted) };
  }

  const characterStyles = builtinCharacterStyles();
  return {
    ...raw,
    formatVersion: 2,
    stories,
    paragraphStyleOrder,
    paragraphStyles,
    characterStyleOrder: [NONE_CHARACTER_ID],
    characterStyles,
    baselineGrid: { start: 0, increment: 12 },
  };
}
