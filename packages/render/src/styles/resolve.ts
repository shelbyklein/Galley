/**
 * Style to CSS: turns a resolved paragraph (or run) from the model (`resolveParagraph`, `resolveRun` in @galley/model) into
 * the CSS the page renderer, the in-place editor and the thread engine's measurement host put on a `<p>` or `<span>`.
 *
 * Contract:
 *   - It reads only the print and shared layers (the web layer is stored, never drawn by the print renderer).
 *   - A paragraph gets every property it needs on its own `<p>`; nothing relies on being inherited from the frame box, so the
 *     same declarations work in a thread slot that starts in the middle of a story.
 *   - For a v1 document (migrated) the declarations are exactly the ones the Phase 1 renderer put on the frame box: font
 *     family, weight, style, size, line height, letter spacing, alignment and color, and nothing else. Properties that are at
 *     their neutral value (no indent, no spacing, hyphenation on, no case, no features, kerning on) emit nothing.
 *   - A run gets only what differs from its paragraph, so an unmarked run has no style at all.
 *   - Colors only ever come from the `ColorResolver` (screen soft proof, or export sentinels).
 *
 * Not emitted here yet (lane S, P2-04 and P2-05, extends this file): drop caps (they need `::first-letter`, so a generated
 * stylesheet rather than an inline style), `alignToBaselineGrid` (a layout decision, P2-08), and the continued-paragraph rules
 * of a thread (P2-02). Space before the first paragraph of a frame is dropped by the caller (`dropSpaceBefore`).
 */
import type { ResolvedParagraph } from '@galley/model';
import type { CSSProperties } from 'react';
import type { ColorResolver } from '../color';
import { num, pt } from '../geometry';

export interface ParagraphCssOptions {
  /** The first paragraph of a frame: space before is dropped, as InDesign does at the top of a frame. */
  dropSpaceBefore?: boolean;
}

/** `"liga" 1, "onum" 1`, or undefined when there is nothing to switch. Sorted by tag so the output is stable. */
function featureSettings(features: ResolvedParagraph['features']): string | undefined {
  const tags = Object.keys(features).sort();
  return tags.length > 0 ? tags.map((t) => `"${t}" ${features[t] ? 1 : 0}`).join(', ') : undefined;
}

/** Declarations that depend only on the character-level properties, shared by paragraphs and runs. */
function characterCss(r: ResolvedParagraph, colors: ColorResolver): CSSProperties {
  const css: CSSProperties = {
    fontFamily: `"${r.fontFamily}", sans-serif`,
    fontWeight: r.fontWeight,
    fontStyle: r.fontStyle,
    fontSize: pt(r.fontSize),
    lineHeight: pt(r.leading),
    letterSpacing: r.tracking !== 0 ? `${num(r.tracking / 1000)}em` : undefined,
    color: colors.css(r.fill),
  };
  if (r.textCase === 'allCaps') css.textTransform = 'uppercase';
  if (r.textCase === 'smallCaps') css.fontVariantCaps = 'small-caps';
  if (r.kerning === 'none') css.fontKerning = 'none';
  const features = featureSettings(r.features);
  if (features) css.fontFeatureSettings = features;
  return css;
}

/** The CSS of a paragraph: its typography, alignment, indents, spacing and hyphenation. */
export function paragraphCss(r: ResolvedParagraph, colors: ColorResolver, options: ParagraphCssOptions = {}): CSSProperties {
  const css = characterCss(r, colors);
  css.textAlign = r.align;
  if (!r.hyphenate) css.hyphens = 'manual';
  if (r.hyphenMinWord !== null || r.hyphenMinBefore !== null || r.hyphenMinAfter !== null) {
    // `hyphenate-limit-chars: <shortest word> <before> <after>`; `auto` leaves a limit to the engine
    (css as Record<string, string>).hyphenateLimitChars = [r.hyphenMinWord, r.hyphenMinBefore, r.hyphenMinAfter].map((n) => (n === null ? 'auto' : String(n))).join(' ');
  }
  if (r.firstLineIndent !== 0) css.textIndent = pt(r.firstLineIndent);
  if (r.leftIndent !== 0) css.paddingLeft = pt(r.leftIndent);
  if (r.rightIndent !== 0) css.paddingRight = pt(r.rightIndent);
  if (r.spaceBefore !== 0 && !options.dropSpaceBefore) css.paddingTop = pt(r.spaceBefore);
  if (r.spaceAfter !== 0) css.paddingBottom = pt(r.spaceAfter);
  return stripUndefined(css);
}

/**
 * The CSS of a run: only the character-level declarations that differ from its paragraph's. An unmarked run, or one whose
 * marks change nothing, gives `{}`.
 */
export function runCss(paragraph: ResolvedParagraph, run: ResolvedParagraph, colors: ColorResolver): CSSProperties {
  if (run === paragraph) return {};
  const base = characterCss(paragraph, colors);
  const own = characterCss(run, colors);
  const css: Record<string, unknown> = {};
  for (const key of Object.keys(own) as (keyof CSSProperties)[]) {
    if (own[key] !== base[key]) css[key] = own[key];
  }
  // switching a property off needs an explicit value, because the paragraph's declaration would otherwise be inherited
  if (run.textCase !== paragraph.textCase) {
    delete css.textTransform;
    delete css.fontVariantCaps;
    if (run.textCase === 'allCaps') css.textTransform = 'uppercase';
    else if (paragraph.textCase === 'allCaps') css.textTransform = 'none';
    if (run.textCase === 'smallCaps') css.fontVariantCaps = 'small-caps';
    else if (paragraph.textCase === 'smallCaps') css.fontVariantCaps = 'normal';
  }
  if (run.kerning !== paragraph.kerning) css.fontKerning = run.kerning === 'none' ? 'none' : 'normal';
  // tracking is in em: a run with another size needs its own letter spacing, or it would inherit the paragraph's in absolute units
  if (run.tracking !== 0 && (run.tracking !== paragraph.tracking || run.fontSize !== paragraph.fontSize)) css.letterSpacing = own.letterSpacing;
  if (run.tracking !== paragraph.tracking && run.tracking === 0) css.letterSpacing = 'normal';
  if (!sameFeatures(run.features, paragraph.features) && !css.fontFeatureSettings) css.fontFeatureSettings = 'normal';
  if (run.baselineShift !== paragraph.baselineShift) css.verticalAlign = pt(run.baselineShift - paragraph.baselineShift);
  return stripUndefined(css as CSSProperties);
}

const sameFeatures = (a: ResolvedParagraph['features'], b: ResolvedParagraph['features']) => featureSettings(a) === featureSettings(b);

function stripUndefined(css: CSSProperties): CSSProperties {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(css)) if (v !== undefined) out[k] = v;
  return out as CSSProperties;
}

/** The `lang` attribute of a paragraph: it picks the hyphenation dictionary. */
export function paragraphLanguage(r: ResolvedParagraph): string {
  return r.language;
}

/**
 * CSS declarations as text (`font-size: 12pt; line-height: 15pt`), property names in kebab case, in the order given. For
 * snapshot tests and for stylesheets built from resolved styles.
 */
export function toCssText(css: CSSProperties): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${String(v)}`)
    .join('; ');
}
