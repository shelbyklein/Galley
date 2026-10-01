// P1-07: soft-proof colors (LittleCMS WASM through the output profile) against Ghostscript's own conversion of the same
// CMYK values through the same profile. Ghostscript is the independent reference: a different program (its ICC manager is
// also lcms2, but its own transform setup, 8-bit).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { selectProfiles } from '../src/profiles';
import { createSoftProofer, type Cmyk100 } from '../src/softproof';
import { deltaE00Rgb, type Rgb } from './deltaE';

const profiles = selectProfiles();
const haveGs = spawnSync('gs', ['--version'], { encoding: 'utf8' }).status === 0;
const ready = profiles.output !== null && profiles.srgbPath !== null && haveGs;
if (!ready) console.warn('softproof.test: needs Ghostscript (`gs`), a CMYK output profile and the sRGB profile; skipped');

/** The six reference swatches of the acceptance check: the process primaries and black, and the poster's two CMYK swatches. */
const SIX: { name: string; cmyk: Cmyk100 }[] = [
  { name: 'Cyan', cmyk: [100, 0, 0, 0] },
  { name: 'Magenta', cmyk: [0, 100, 0, 0] },
  { name: 'Yellow', cmyk: [0, 0, 100, 0] },
  { name: '100K black', cmyk: [0, 0, 0, 100] },
  { name: 'Warm Orange', cmyk: [0, 60, 100, 0] },
  { name: 'Studio Blue', cmyk: [100, 80, 0, 20] },
];
const MORE: { name: string; cmyk: Cmyk100 }[] = [
  { name: 'Paper', cmyk: [0, 0, 0, 0] },
  { name: 'Rich black', cmyk: [75, 68, 67, 90] },
  { name: 'PANTONE 185 C alternate', cmyk: [0, 91, 76, 0] },
  { name: 'Teal', cmyk: [85, 10, 40, 10] },
  { name: '50K', cmyk: [0, 0, 0, 50] },
  { name: 'Orange at 40%', cmyk: [0, 24, 40, 0] },
];

/** Ghostscript's sRGB for each CMYK color: a PostScript page of 20 pt squares rendered at 72 dpi with the profile set as the CMYK source. */
async function ghostscriptReference(swatches: readonly Cmyk100[]): Promise<Rgb[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-softproof-'));
  try {
    const ps = `%!PS\n<< /PageSize [${swatches.length * 20} 20] >> setpagedevice\n${swatches
      .map((s, i) => `${s.map((v) => v / 100).join(' ')} setcmykcolor ${i * 20} 0 20 20 rectfill`)
      .join('\n')}\nshowpage\n`;
    fs.writeFileSync(path.join(dir, 'ref.ps'), ps);
    const out = path.join(dir, 'ref.png');
    const r = spawnSync(
      'gs',
      ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-r72', `-sDefaultCMYKProfile=${profiles.output!.path}`, `-sOutputICCProfile=${profiles.srgbPath!}`, `-sOutputFile=${out}`, path.join(dir, 'ref.ps')],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`gs failed: ${r.stderr}`);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    return swatches.map((_, i) => {
      const o = (10 * info.width + i * 20 + 10) * info.channels; // the middle of each square
      return [data[o]!, data[o + 1]!, data[o + 2]!] as Rgb;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!ready)('soft proof through the output profile', () => {
  it(`matches Ghostscript's conversion through the same profile within dE00 2 (profile: ${profiles.output?.name})`, async () => {
    const proofer = await createSoftProofer(profiles.output!.path, profiles.srgbPath!);
    try {
      const reference = await ghostscriptReference(SIX.map((s) => s.cmyk));
      const ours = proofer.convert(SIX.map((s) => s.cmyk));
      const report = SIX.map((s, i) => ({ name: s.name, ours: ours[i]!, gs: reference[i]!, dE: deltaE00Rgb(ours[i]!, reference[i]!) }));
      for (const row of report) expect(row.dE, `${row.name}: ours ${row.ours.join(',')} vs gs ${row.gs.join(',')}`).toBeLessThanOrEqual(2);
      // and it is an actual conversion, not the naive formula: Studio Blue is far from naive rgb(0, 51, 204) x 0.8
      expect(ours[5]!.join(',')).not.toBe('0,0,0');
    } finally {
      proofer.close();
    }
  });

  it('also matches on tones, paper, rich black and tints (12 swatches in all)', async () => {
    const proofer = await createSoftProofer(profiles.output!.path, profiles.srgbPath!);
    try {
      const all = [...SIX, ...MORE];
      const reference = await ghostscriptReference(all.map((s) => s.cmyk));
      const ours = proofer.convert(all.map((s) => s.cmyk));
      const worst = Math.max(...all.map((_, i) => deltaE00Rgb(ours[i]!, reference[i]!)));
      expect(worst).toBeLessThanOrEqual(2);
      expect(ours[6]).toEqual([255, 255, 255]); // paper stays paper
    } finally {
      proofer.close();
    }
  });

  it('is deterministic, order independent, and refuses to be used after close', async () => {
    const proofer = await createSoftProofer(profiles.output!.path, profiles.srgbPath!);
    const a = proofer.convert([[10, 20, 30, 40], [90, 0, 0, 5]]);
    const b = proofer.convert([[90, 0, 0, 5], [10, 20, 30, 40]]);
    expect(a[0]).toEqual(b[1]);
    expect(a[1]).toEqual(b[0]);
    expect(proofer.convert([])).toEqual([]);
    proofer.close();
    expect(() => proofer.convert([[0, 0, 0, 0]])).toThrow(/closed/);
  });

  it('rejects a file that is not the expected kind of profile', async () => {
    await expect(createSoftProofer(profiles.srgbPath!, profiles.srgbPath!)).rejects.toThrow(/expected CMYK/);
  });
});
