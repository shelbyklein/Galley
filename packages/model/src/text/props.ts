/**
 * Text properties: the vocabulary shared by paragraph styles, character styles and local overrides.
 *
 * Every property belongs to one of three layers (PLAN.md section 1, "Styles have three layers"):
 *
 *   shared   what the text is: family, weight and style, color, tracking, kerning, case, OpenType features, language
 *            (and, for paragraphs, the semantic role)
 *   print    how it is set on paper: size, leading, baseline shift (characters too); indents, space before and after,
 *            alignment, hyphenation and its limits, baseline-grid alignment and drop caps (paragraphs only). Points.
 *   web      how the web ruleset sets it: fluid size, line height, HTML tag, breakpoint overrides. Stored and shown, never
 *            used by the print renderer; Phase 6 edits it.
 *
 * A style (or an override) is a set of three *partial* layers: a property that is absent is inherited. Resolving a
 * paragraph walks the `basedOn` chain from the root, then the paragraph's local overrides (./styles.ts); resolving a run
 * adds its character style chain and its local override mark on top. A resolved paragraph has every property set.
 *
 * Property names are unique across layers, so the flat resolved shape needs no layer prefix.
 */
import { z } from 'zod';
import { paint, paintSchema, SWATCH_BLACK, type Paint } from '../swatch';
import { positiveSchema, ptSchema, sizeSchema } from '../units';

// ------------------------------------------------------------------------------------------------------- shared layer

/** An OpenType feature tag: four characters (`liga`, `smcp`, `onum`, `frac`, `ss01`). */
export const featureTagSchema = z.string().regex(/^[A-Za-z0-9]{4}$/, 'must be a four character OpenType feature tag');
/** Features to switch on or off, by tag. A style's features merge key by key with the style it is based on. */
export const featuresSchema = z.record(featureTagSchema, z.boolean());

/** A BCP 47 language tag such as `en-US`; it picks the hyphenation dictionary. */
export const languageSchema = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a language tag such as en-US');

export const TEXT_ROLES = ['body', 'heading', 'subhead', 'caption', 'quote'] as const;
export const textRoleSchema = z.enum(TEXT_ROLES);

const sharedCharShape = {
  fontFamily: z.string().min(1),
  /** CSS weight, 1 to 1000 (400 regular, 700 bold, 800 extra bold). */
  fontWeight: z.number().int().min(1).max(1000),
  fontStyle: z.enum(['normal', 'italic']),
  /** The text color: a swatch at a tint, optionally overprinting. */
  fill: paintSchema,
  /** Letter spacing in thousandths of an em (InDesign tracking units). */
  tracking: z.number(),
  kerning: z.enum(['metrics', 'none']),
  textCase: z.enum(['normal', 'allCaps', 'smallCaps']),
  features: featuresSchema,
  language: languageSchema,
};

export const sharedCharPropsSchema = z.strictObject(sharedCharShape).partial();
/** Paragraph styles add the semantic role (`null`: none). */
export const sharedParaPropsSchema = z.strictObject({ ...sharedCharShape, role: textRoleSchema.nullable() }).partial();
export type SharedCharProps = z.infer<typeof sharedCharPropsSchema>;
export type SharedParaProps = z.infer<typeof sharedParaPropsSchema>;

// -------------------------------------------------------------------------------------------------------- print layer

const hyphenLimit = z.number().int().min(1).max(50).nullable();

const printCharShape = {
  /** Points. */
  fontSize: positiveSchema,
  /** Fixed line height in points; any value is allowed (P2-08 proves how non-0.75 pt values print). */
  leading: positiveSchema,
  /** Points, positive moves the text up. */
  baselineShift: ptSchema,
};

const printParaShape = {
  fontSize: printCharShape.fontSize,
  leading: printCharShape.leading,
  /** Points; negative makes a hanging indent. */
  firstLineIndent: ptSchema,
  leftIndent: sizeSchema,
  rightIndent: sizeSchema,
  spaceBefore: sizeSchema,
  spaceAfter: sizeSchema,
  align: z.enum(['left', 'center', 'right', 'justify']),
  hyphenate: z.boolean(),
  /** Shortest word to hyphenate, letters before the break, letters after the break. `null`: the engine's own limit. */
  hyphenMinWord: hyphenLimit,
  hyphenMinBefore: hyphenLimit,
  hyphenMinAfter: hyphenLimit,
  /** Most consecutive hyphenated lines; 0 or `null`: no limit. */
  hyphenLadder: z.number().int().min(0).max(25).nullable(),
  alignToBaselineGrid: z.boolean(),
  /** Drop cap: how many lines deep (0: none) and how many characters. */
  dropCapLines: z.number().int().min(0).max(25),
  dropCapChars: z.number().int().min(1).max(25),
};

export const printCharPropsSchema = z.strictObject(printCharShape).partial();
export const printParaPropsSchema = z.strictObject(printParaShape).partial();
export type PrintCharProps = z.infer<typeof printCharPropsSchema>;
export type PrintParaProps = z.infer<typeof printParaPropsSchema>;

// --------------------------------------------------------------------------------------------------------- web layer

/** A CSS length or number as written for the web (`1rem`, `clamp(1rem, 2vw, 1.5rem)`, `1.5`). */
const cssValue = z.string().min(1);
const webBreakpointSchema = z.strictObject({ fontSize: cssValue.optional(), lineHeight: cssValue.optional() });

/** Stored now, edited in Phase 6: fluid size, line height, HTML tag and per-breakpoint overrides. */
export const webPropsSchema = z.strictObject({
  fontSize: cssValue.optional(),
  lineHeight: cssValue.optional(),
  tag: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase HTML tag name').optional(),
  breakpoints: z.record(z.string().min(1), webBreakpointSchema).optional(),
});
export type WebProps = z.infer<typeof webPropsSchema>;

// ------------------------------------------------------------------------------------------------------------ layers

export const paragraphLayersSchema = z.strictObject({ shared: sharedParaPropsSchema, print: printParaPropsSchema, web: webPropsSchema });
export const characterLayersSchema = z.strictObject({ shared: sharedCharPropsSchema, print: printCharPropsSchema, web: webPropsSchema });
/** What a style defines: all three layers, each possibly empty. */
export type ParagraphLayers = z.infer<typeof paragraphLayersSchema>;
export type CharacterLayers = z.infer<typeof characterLayersSchema>;

/** Local overrides: the same layers, each optional, only the properties that differ from the style. */
export const paragraphOverridesSchema = z.strictObject({
  shared: sharedParaPropsSchema.optional(),
  print: printParaPropsSchema.optional(),
  web: webPropsSchema.optional(),
});
export const characterOverridesSchema = z.strictObject({
  shared: sharedCharPropsSchema.optional(),
  print: printCharPropsSchema.optional(),
  web: webPropsSchema.optional(),
});
export type ParagraphOverrides = z.infer<typeof paragraphOverridesSchema>;
export type CharacterOverrides = z.infer<typeof characterOverridesSchema>;

/** The three layer names. */
export const LAYER_NAMES = ['shared', 'print', 'web'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

// ---------------------------------------------------------------------------------------------------------- resolved

/**
 * A paragraph, or a run inside one, with every property settled: the output of resolving the style chain and the local
 * overrides. `baselineShift` is only ever set by a character style or an override mark (a paragraph's is 0), and `web` only
 * by paragraph layers; both are here so that a paragraph and a run resolve to the same shape.
 */
export type ResolvedParagraph = Required<SharedParaProps> & Required<PrintParaProps> & { baselineShift: number; web: WebProps };

/**
 * What every style chain starts from, and what `[Basic Paragraph]` holds in a new document: Inter Regular 12/15 pt in
 * [Black], flush left, hyphenation on (the engine's own limits). This is also exactly what a Phase 1 default story
 * looked like, so new text frames render the same as they did.
 */
export const BASIC_PARAGRAPH_PROPS: ResolvedParagraph = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontStyle: 'normal',
  fill: paint(SWATCH_BLACK),
  tracking: 0,
  kerning: 'metrics',
  textCase: 'normal',
  features: {},
  language: 'en-US',
  role: null,
  fontSize: 12,
  leading: 15,
  baselineShift: 0,
  firstLineIndent: 0,
  leftIndent: 0,
  rightIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  align: 'left',
  hyphenate: true,
  hyphenMinWord: null,
  hyphenMinBefore: null,
  hyphenMinAfter: null,
  hyphenLadder: null,
  alignToBaselineGrid: false,
  dropCapLines: 0,
  dropCapChars: 1,
  web: {},
};

const SHARED_PARA_KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'fill', 'tracking', 'kerning', 'textCase', 'features', 'language', 'role'] as const;
const PRINT_PARA_KEYS = [
  'fontSize',
  'leading',
  'firstLineIndent',
  'leftIndent',
  'rightIndent',
  'spaceBefore',
  'spaceAfter',
  'align',
  'hyphenate',
  'hyphenMinWord',
  'hyphenMinBefore',
  'hyphenMinAfter',
  'hyphenLadder',
  'alignToBaselineGrid',
  'dropCapLines',
  'dropCapChars',
] as const;

/** The property names a character style or override may set, by layer. Everything else is paragraph-only. */
export const CHARACTER_PROPS: { readonly shared: readonly string[]; readonly print: readonly string[] } = {
  shared: SHARED_PARA_KEYS.filter((k) => k !== 'role'),
  print: ['fontSize', 'leading', 'baselineShift'],
};
/** Every paragraph property name by layer (web properties are an open set of their own). A paragraph has no baseline shift. */
export const PARAGRAPH_PROPS: { readonly shared: readonly string[]; readonly print: readonly string[] } = { shared: SHARED_PARA_KEYS, print: PRINT_PARA_KEYS };

/** `[Basic Paragraph]`'s three layers: every shared and print property set explicitly, the web layer empty. */
export function basicParagraphLayers(): ParagraphLayers {
  const flat = structuredClone(BASIC_PARAGRAPH_PROPS);
  const shared: Record<string, unknown> = {};
  const print: Record<string, unknown> = {};
  for (const k of SHARED_PARA_KEYS) shared[k] = flat[k];
  for (const k of PRINT_PARA_KEYS) print[k] = flat[k];
  return { shared: shared as SharedParaProps, print: print as PrintParaProps, web: {} };
}

// ------------------------------------------------------------------------------------------------------------ merging

/** Properties whose value is a record that merges key by key instead of being replaced. */
const KEYWISE = new Set(['features', 'breakpoints']);

/** `over` wins property by property; `features` and web `breakpoints` merge key by key. Returns a new object; neither input changes. */
export function mergeLayerProps<T extends object>(base: T, over: Partial<T> | undefined): T {
  if (!over) return { ...base };
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    out[key] = KEYWISE.has(key) ? { ...((base as Record<string, unknown>)[key] as object | undefined), ...(value as object) } : value;
  }
  return out as T;
}

/** Merge two sets of layers (the second wins). Used to fold a removed base style into the styles that were based on it. */
export function mergeLayers<L extends { shared?: object; print?: object; web?: object }>(base: L, over: L | undefined): L {
  return {
    shared: mergeLayerProps((base.shared ?? {}) as object, over?.shared as object | undefined),
    print: mergeLayerProps((base.print ?? {}) as object, over?.print as object | undefined),
    web: mergeLayerProps((base.web ?? {}) as object, over?.web as object | undefined),
  } as L;
}

/** True when a set of (optional) layers holds no property at all. */
export function layersAreEmpty(layers: { shared?: object; print?: object; web?: object } | null | undefined): boolean {
  if (!layers) return true;
  return Object.values(layers.shared ?? {}).every((v) => v === undefined) && Object.values(layers.print ?? {}).every((v) => v === undefined) && Object.values(layers.web ?? {}).every((v) => v === undefined);
}

/** A copy of the layers without `undefined` values and without empty layers. */
export function compactLayers<L extends { shared?: object; print?: object; web?: object }>(layers: L): L {
  const out: Record<string, object> = {};
  for (const name of LAYER_NAMES) {
    const part = layers[name];
    if (!part) continue;
    const kept = Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined));
    if (Object.keys(kept).length > 0) out[name] = kept;
  }
  return out as L;
}

// ------------------------------------------------------------------------------------------------- flat convenience

/**
 * The flat shape of the Phase 1 story default (`defaults`): family, weight, style, size, leading, tracking, alignment,
 * color. The v1 to v2 migration reads it, and `textAttrsToLayers` turns it into layers for fixtures and tests.
 */
export interface TextAttrs {
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  fontSize: number;
  leading: number;
  tracking: number;
  align: 'left' | 'center' | 'right' | 'justify';
  fill: Paint;
}

/** Split flat text attributes into style layers (shared: family, weight, style, tracking, fill; print: size, leading, align). */
export function textAttrsToLayers(attrs: Partial<TextAttrs>): ParagraphLayers {
  const shared: SharedParaProps = {};
  const print: PrintParaProps = {};
  if (attrs.fontFamily !== undefined) shared.fontFamily = attrs.fontFamily;
  if (attrs.fontWeight !== undefined) shared.fontWeight = attrs.fontWeight;
  if (attrs.fontStyle !== undefined) shared.fontStyle = attrs.fontStyle;
  if (attrs.tracking !== undefined) shared.tracking = attrs.tracking;
  if (attrs.fill !== undefined) shared.fill = attrs.fill;
  if (attrs.fontSize !== undefined) print.fontSize = attrs.fontSize;
  if (attrs.leading !== undefined) print.leading = attrs.leading;
  if (attrs.align !== undefined) print.align = attrs.align;
  return { shared, print, web: {} };
}
