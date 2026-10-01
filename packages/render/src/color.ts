/**
 * Color modes. The page renderer never writes a color directly; it asks a `ColorResolver` for every paint.
 *
 *   screen   what the editor shows. Lane A (P1-07) replaces the temporary naive CMYK to RGB conversion below with a
 *            real soft proof through the output profile, by passing `softProof` (or a whole resolver) to the view.
 *   export   what the hidden export window prints: every ink becomes its unique sentinel RGB (see
 *            @galley/model/sentinels), and nothing else is painted with a document color. The prepress step then swaps
 *            sentinels for exact CMYK and spot colors.
 */
import { buildSentinelTable, inkKey, resolveInk, sentinelCss, sentinelsByKey, type GalleyDocument, type Ink, type Paint, type Rgb255 } from '@galley/model';

export type ColorMode = 'screen' | 'export';

export interface ColorResolver {
  readonly mode: ColorMode;
  /** A CSS color for a paint, or `none` for [None] (a null paint), which SVG `fill`/`stroke` accept. */
  css(paint: Paint | null | undefined): string;
}

/** Soft-proof hook: return the display RGB (0..255) for an ink, or undefined to fall back to the naive conversion. */
export type SoftProofFn = (ink: Ink) => Rgb255 | undefined;

/**
 * TEMPORARY, replaced by the ICC soft proof in P1-07. The textbook formula R = 255 (1 - C)(1 - K), with spot colors
 * shown through their CMYK alternate and tints scaling the ink toward paper. It is saturated and does not match print.
 */
export function naiveCmykToRgb(ink: Pick<Ink, 'values' | 'tint'>): Rgb255 {
  const t = ink.tint / 100;
  const [c, m, y, k] = ink.values.map((v) => (v / 100) * t) as [number, number, number, number];
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)].map((v) => Math.round(v)) as Rgb255;
}

const rgbCss = ([r, g, b]: Rgb255) => `rgb(${r} ${g} ${b})`;

export interface ColorResolverOptions {
  softProof?: SoftProofFn;
}

export function createColorResolver(doc: GalleyDocument, mode: ColorMode, options: ColorResolverOptions = {}): ColorResolver {
  if (mode === 'export') {
    const table = sentinelsByKey(buildSentinelTable(doc));
    return {
      mode,
      css(paint) {
        if (!paint) return 'none';
        const entry = table.get(inkKey(resolveInk(doc, paint)));
        if (!entry) throw new Error(`No sentinel for swatch "${paint.swatchId}" (tint ${paint.tint}); the sentinel table does not cover this paint`);
        return sentinelCss(entry);
      },
    };
  }
  const cache = new Map<string, string>();
  return {
    mode,
    css(paint) {
      if (!paint) return 'none';
      const ink = resolveInk(doc, paint);
      const key = inkKey(ink);
      let css = cache.get(key);
      if (css === undefined) {
        css = rgbCss(options.softProof?.(ink) ?? naiveCmykToRgb(ink));
        cache.set(key, css);
      }
      return css;
    },
  };
}
