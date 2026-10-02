// Helpers for reading Ghostscript tiffsep output and measuring ink coverage.
//
// tiffsep pixel convention (verified in FINDINGS): each plate is an 8-bit gray TIFF, PhotometricInterpretation
// BlackIsZero, LZW. 255 = no ink (paper), 0 = 100% ink. So ink% = (255 - v) / 255 * 100.
import sharp from 'sharp';

export interface Plate { name: string; w: number; h: number; ink: Float32Array } // ink in 0..100

export async function readPlate(file: string, name: string): Promise<Plate> {
  const { data, info } = await sharp(file).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const ink = new Float32Array(info.width * info.height);
  for (let i = 0; i < ink.length; i++) ink[i] = ((255 - data[i]) / 255) * 100;
  return { name, w: info.width, h: info.height, ink };
}

export interface Rect { x: number; y: number; w: number; h: number } // pixels

export function stats(p: Plate, r: Rect, pred?: (i: number) => boolean) {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(p.w, Math.round(r.x + r.w)), y1 = Math.min(p.h, Math.round(r.y + r.h));
  let n = 0, sum = 0, min = 100, max = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * p.w + x;
    if (pred && !pred(i)) continue;
    const v = p.ink[i]; n++; sum += v; if (v < min) min = v; if (v > max) max = v;
  }
  return { n, mean: n ? sum / n : 0, min: n ? min : 0, max: n ? max : 0 };
}
