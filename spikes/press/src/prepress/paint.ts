// Swatch-table "paint" entries (one per swatch / tint / overprint variant) and sentinel lookup.
export interface Paint {
  id: string;
  name: string;
  type: 'cmyk' | 'spot';
  values: number[]; // CMYK percent (for spot: the CMYK alternate)
  tint: number; // percent
  overprint: boolean;
  proofRGB: [number, number, number];
  rgb: [number, number, number]; // the sentinel RGB assigned at export time
  spotName?: string;
}

export const fmt = (n: number) => {
  const s = n.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s;
};

/** Process-colour tint: scale every ink by tint% (what InDesign does for a CMYK swatch tint). Returns 0..1 values. */
export function effectiveCmyk(p: Paint): number[] {
  return p.values.map((v) => (v * p.tint) / 10000);
}

export class SentinelTable {
  private map = new Map<string, Paint>();
  /** worst |value*255 - round(value*255)| seen in the content (Skia prints 4 decimals) */
  maxRoundingError = 0;
  constructor(readonly paints: Paint[]) {
    for (const p of paints) this.map.set(p.rgb.join(','), p);
  }
  /** Round each channel to the nearest 1/255 and look it up. */
  lookup(r: number, g: number, b: number): Paint | null {
    const f = [r, g, b].map((v) => v * 255);
    const R = f.map((v) => Math.round(v));
    for (let i = 0; i < 3; i++) this.maxRoundingError = Math.max(this.maxRoundingError, Math.abs(f[i] - R[i]));
    return this.map.get(R.join(',')) ?? null;
  }
  /** Nearest sentinel within `tol` levels (Chebyshev) per channel, or null. Sentinels are 15 apart so tol<=7 is unambiguous. */
  nearest(r: number, g: number, b: number, tol: number): Paint | null {
    let best: Paint | null = null, bd = Infinity;
    for (const p of this.paints) {
      const dd = Math.max(Math.abs(p.rgb[0] - r), Math.abs(p.rgb[1] - g), Math.abs(p.rgb[2] - b));
      if (dd < bd) { bd = dd; best = p; }
    }
    return bd <= tol ? best : null;
  }
}
