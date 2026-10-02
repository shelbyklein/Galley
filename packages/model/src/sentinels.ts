/**
 * Sentinel colors: how the editor's export mode and the prepress step agree on ink.
 *
 * Chromium's printToPDF only writes RGB. For export, the renderer paints every swatch with a unique "sentinel" RGB
 * value instead of its real color; the prepress step finds each sentinel in the PDF's content stream and swaps it for
 * the exact CMYK (`k`/`K`) or spot (`/Separation`) color it stands for, with no ICC conversion. See
 * spikes/press/FINDINGS.md (ported from spikes/press/src/sentinel.cjs).
 *
 * A sentinel stands for one *ink*, not one swatch: a swatch, at a tint, with or without overprint. Both sides compute
 * the table from the document with `buildSentinelTable(doc)`, which is a pure, deterministic function of the document
 * (the table is sorted by key, never by insertion order), so the renderer and prepress get identical tables with no
 * file handed between them. The table is plain data, so the export orchestrator can also serialize it as JSON.
 *
 * Capacity: 16 levels per channel, so 4096 distinct inks per document.
 */
import type { Id } from './ids';
import { getSwatch } from './queries';
import type { GalleyDocument } from './schema';
import type { Cmyk, Paint } from './swatch';
import { paragraphAttrs } from './text/story';
import { resolveParagraph, resolveRun } from './text/styles';

/**
 * Sentinel channel levels are BASE + STEP * digit (digit 0..15). STEP is 15 (the spike found >= 5 necessary) so
 * Skia's float rounding can never make two sentinels collide, and BASE keeps sentinels away from pure black and
 * white, which Chromium itself emits for unstyled content.
 */
export const SENTINEL_STEP = 15;
export const SENTINEL_BASE = 10;
export const SENTINEL_CAPACITY = 16 * 16 * 16;

export type Rgb255 = [number, number, number];

/** The i-th sentinel RGB: the three base-16 digits of i, each mapped to BASE + STEP * digit. */
export function sentinelFor(i: number): Rgb255 {
  if (!Number.isInteger(i) || i < 0 || i >= SENTINEL_CAPACITY) throw new RangeError(`Sentinel index ${i} is out of range 0..${SENTINEL_CAPACITY - 1}`);
  const d0 = i % 16;
  const d1 = Math.floor(i / 16) % 16;
  const d2 = Math.floor(i / 256) % 16;
  return [SENTINEL_BASE + SENTINEL_STEP * d2, SENTINEL_BASE + SENTINEL_STEP * d1, SENTINEL_BASE + SENTINEL_STEP * d0];
}

/** What a sentinel stands for: the prepress step emits exactly this color. */
export interface Ink {
  /** The cmyk or spot swatch this ink is made from (a tint swatch resolves to its base). */
  swatchId: Id;
  /** The swatch name; for a spot ink, the separation name (`PANTONE 185 C`). */
  name: string;
  model: 'cmyk' | 'spot';
  /** Process: C, M, Y, K percent at 100%. Spot: the CMYK alternate. */
  values: Cmyk;
  /** Effective percent of the ink, 0 to 100 (swatch tint x paint tint). */
  tint: number;
  overprint: boolean;
}

export interface SentinelEntry extends Ink {
  /** `<swatchId>|<tint>|<op|ko>`: unique per ink, and the sort key. */
  key: string;
  rgb: Rgb255;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Resolve a paint to the ink it prints: through a tint swatch to its base swatch, multiplying the tints. */
export function resolveInk(doc: GalleyDocument, paint: Paint): Ink {
  const swatch = getSwatch(doc, paint.swatchId);
  if (swatch.type === 'tint') {
    const base = getSwatch(doc, swatch.baseId);
    if (base.type === 'tint') throw new Error(`Tint swatch "${swatch.id}" is based on another tint swatch`);
    return { swatchId: base.id, name: base.name, model: base.type, values: base.values, tint: round4((swatch.percent * paint.tint) / 100), overprint: paint.overprint };
  }
  return { swatchId: swatch.id, name: swatch.name, model: swatch.type, values: swatch.values, tint: round4(paint.tint), overprint: paint.overprint };
}

export function inkKey(ink: Pick<Ink, 'swatchId' | 'tint' | 'overprint'>): string {
  return `${ink.swatchId}|${ink.tint}|${ink.overprint ? 'op' : 'ko'}`;
}

/** The key of the sentinel a paint maps to. */
export function paintKey(doc: GalleyDocument, paint: Paint): string {
  return inkKey(resolveInk(doc, paint));
}

/**
 * Every paint in the document that can end up on the page: frame fills and strokes, and the text colors the stories resolve to
 * (each paragraph's color from its style chain and overrides, and the color of each run a character style or override changes).
 * A style nothing uses adds no ink.
 */
export function collectPaints(doc: GalleyDocument): Paint[] {
  const out: Paint[] = [];
  for (const f of Object.values(doc.frames)) {
    if (f.type === 'group') continue;
    if (f.fill) out.push(f.fill);
    if (f.stroke) out.push(f.stroke.paint);
  }
  for (const s of Object.values(doc.stories)) {
    for (const p of s.doc.content ?? []) {
      const paragraph = resolveParagraph(doc, paragraphAttrs(p));
      out.push(paragraph.fill);
      for (const run of p.content ?? []) {
        if (!run.marks || run.marks.length === 0) continue;
        const fill = resolveRun(doc, paragraph, run.marks).fill;
        if (fill !== paragraph.fill) out.push(fill);
      }
    }
  }
  return out;
}

/** The sentinel table for a document: one entry per distinct ink in use, sorted by key, sentinels assigned in that order. */
export function buildSentinelTable(doc: GalleyDocument): SentinelEntry[] {
  const inks = new Map<string, Ink>();
  for (const paint of collectPaints(doc)) {
    const ink = resolveInk(doc, paint);
    inks.set(inkKey(ink), ink);
  }
  if (inks.size > SENTINEL_CAPACITY) throw new RangeError(`This document uses ${inks.size} distinct inks; the limit is ${SENTINEL_CAPACITY}`);
  return [...inks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, ink], i) => ({ ...ink, key, rgb: sentinelFor(i) }));
}

/** Index a table by ink key, for the renderer. */
export function sentinelsByKey(table: readonly SentinelEntry[]): Map<string, SentinelEntry> {
  return new Map(table.map((e) => [e.key, e]));
}

/** The CSS color for a sentinel: `rgb(10 25 40)`. */
export function sentinelCss(entry: Pick<SentinelEntry, 'rgb'>): string {
  return `rgb(${entry.rgb[0]} ${entry.rgb[1]} ${entry.rgb[2]})`;
}

/** Whether a CSS color string is exactly one of the table's sentinels. Accepts `rgb(r g b)` and `rgb(r, g, b)`. */
export function isSentinelCss(table: readonly SentinelEntry[], css: string): boolean {
  const m = /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/i.exec(css.trim());
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return table.some((e) => e.rgb[0] === r && e.rgb[1] === g && e.rgb[2] === b);
}

/**
 * Map a color found in a PDF content stream back to its entry. `r`, `g`, `b` are the 0..1 floats of an `rg`/`RG`
 * operator; each is rounded to the nearest 1/255, then matched exactly. Returns null when it is not a sentinel
 * (the page's own white or black, an image, ...).
 */
export function lookupSentinel(table: readonly SentinelEntry[], r: number, g: number, b: number): SentinelEntry | null {
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  return table.find((e) => e.rgb[0] === R && e.rgb[1] === G && e.rgb[2] === B) ?? null;
}
