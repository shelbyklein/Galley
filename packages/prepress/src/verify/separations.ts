// Ghostscript `tiffsep` separations of a PDF, read back as ink plates. Ported from the press spike (verify.ts, plates.ts).
//
// tiffsep writes one 8-bit gray TIFF per plate (Cyan, Magenta, Yellow, Black and one per spot color, named in the file
// name): 255 = no ink, 0 = 100% ink, so ink% = (255 - v) / 255 * 100. This is an independent renderer of the PDF's
// ink, which is the point: it is what a RIP would separate, not what our own code believes it wrote.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readPlate, stats, type Plate, type Rect } from './plates.ts';

export { readPlate, stats, type Plate, type Rect };

export interface Separations {
  C: Plate;
  M: Plate;
  Y: Plate;
  K: Plate;
  /** One plate per spot color, by the separation name in the PDF. */
  spots: Record<string, Plate>;
  /** Device pixels per point, `dpi / 72`. */
  scale: number;
}

export const DEFAULT_DPI = 144;

/** Run `gs -sDEVICE=tiffsep` on page 1 and read every plate. `outputProfile` makes Ghostscript convert RGB to CMYK through that ICC profile. */
export async function separate(pdfPath: string, outDir: string, dpi = DEFAULT_DPI, outputProfile?: string): Promise<Separations> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const r = spawnSync('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-dFirstPage=1', '-dLastPage=1', '-sDEVICE=tiffsep', `-r${dpi}`, ...(outputProfile ? [`-sOutputICCProfile=${outputProfile}`] : []), `-sOutputFile=${path.join(outDir, 'p%d.tif')}`, pdfPath], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) throw new Error(`Ghostscript tiffsep failed: ${r.stderr || r.stdout}`);
  const named: Record<string, Plate> = {};
  for (const f of fs.readdirSync(outDir)) {
    const m = /^p1\((.+)\)\.tif$/.exec(f);
    if (m) named[m[1]!] = await readPlate(path.join(outDir, f), m[1]!);
  }
  const { Cyan, Magenta, Yellow, Black, ...spots } = named;
  if (!Cyan || !Magenta || !Yellow || !Black) throw new Error(`tiffsep did not write the four process plates (found ${Object.keys(named).join(', ')})`);
  return { C: Cyan, M: Magenta, Y: Yellow, K: Black, spots, scale: dpi / 72 };
}

/** Mean and extremes of every plate over a rectangle, optionally only over the pixels where `pred` holds. */
export function measureRegion(seps: Separations, rect: Rect, pred?: (i: number) => boolean) {
  const c = stats(seps.C, rect, pred);
  const m = stats(seps.M, rect, pred);
  const y = stats(seps.Y, rect, pred);
  const k = stats(seps.K, rect, pred);
  const spots: Record<string, { mean: number; max: number; min: number }> = {};
  for (const [name, plate] of Object.entries(seps.spots)) {
    const s = stats(plate, rect, pred);
    spots[name] = { mean: s.mean, max: s.max, min: s.min };
  }
  return {
    n: k.n,
    mean: { C: c.mean, M: m.mean, Y: y.mean, K: k.mean },
    max: { C: c.max, M: m.max, Y: y.max, K: k.max },
    min: { C: c.min, M: m.min, Y: y.min, K: k.min },
    spots,
  };
}
export type Measure = ReturnType<typeof measureRegion>;
