// The sentinel table as the prepress step sees it. The assignment of sentinel colors to inks is NOT done here: it is
// `buildSentinelTable(doc)` in @galley/model, the same function the renderer's export mode calls, so both sides always
// agree. This file only looks colors up and turns an ink into the numbers the PDF needs.
import { lookupSentinel, type Ink, type SentinelEntry } from '@galley/model';

/** One ink of the document: a sentinel RGB and the exact CMYK / spot color it stands for. */
export type Paint = SentinelEntry;

export const fmt = (n: number) => {
  const s = n.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s;
};

/** Process-colour tint: scale every ink by tint% (what InDesign does for a CMYK swatch tint). Returns 0..1 values. */
export function effectiveCmyk(p: Pick<Ink, 'values' | 'tint'>): number[] {
  return p.values.map((v) => (v * p.tint) / 10000);
}

export class SentinelTable {
  /** worst |value*255 - round(value*255)| seen in the content (Skia prints 4 decimals) */
  maxRoundingError = 0;
  constructor(readonly paints: readonly Paint[]) {}

  /** Round each channel to the nearest 1/255 and match exactly (the model's `lookupSentinel`). */
  lookup(r: number, g: number, b: number): Paint | null {
    for (const v of [r, g, b]) this.maxRoundingError = Math.max(this.maxRoundingError, Math.abs(v * 255 - Math.round(v * 255)));
    return lookupSentinel(this.paints, r, g, b);
  }

  /** Nearest sentinel within `tol` levels (Chebyshev) per channel, or null. Sentinels are 15 apart so tol<=7 is unambiguous. */
  nearest(r: number, g: number, b: number, tol: number): Paint | null {
    let best: Paint | null = null;
    let bd = Infinity;
    for (const p of this.paints) {
      const dd = Math.max(Math.abs(p.rgb[0] - r), Math.abs(p.rgb[1] - g), Math.abs(p.rgb[2] - b));
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    return bd <= tol ? best : null;
  }
}
