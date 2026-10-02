// Soft proofing: what a CMYK or spot swatch looks like on screen when printed on the output profile. CMYK values go through
// the output profile (the same ICC file the PDF's output intent embeds) to sRGB, with LittleCMS.
//
// Why LittleCMS WASM (lcms-wasm) and not sharp/libvips:
//   - Same CMM as Ghostscript and Chromium (lcms2), and with explicit control of the rendering intent and black point
//     compensation. We use relative colorimetric with BPC, which is also Ghostscript's default and Adobe's: a unit test
//     matches Ghostscript's own conversion through the same profile on 12 swatches: 0.00 on the primaries and
//     the poster swatches, at most 0.89 dE00 on a rich black (the acceptance limit is 2).
//   - sharp can only convert whole images, takes no input profile for raw CMYK pixels (it would need a TIFF round trip
//     to attach one) and exposes no intent or BPC option, so its answer depends on libvips defaults.
//   - 16-bit in, 16-bit out, so no 8-bit quantization of the ink values.
//   - It runs in any process (WASM, 316 kB, no native binary), and we only convert a handful of swatches, so speed is moot.
// Photos still go through sharp in the prepress step (whole-image conversion, which is what sharp is for).
import fs from 'node:fs';

/** C, M, Y, K as percentages 0..100 (ink at the tint it prints, i.e. already multiplied by the tint). */
export type Cmyk100 = readonly [number, number, number, number];
export type Rgb8 = [number, number, number];

export interface SoftProofer {
  /** sRGB 0..255 for each CMYK color, through the output profile. */
  convert(inks: readonly Cmyk100[]): Rgb8[];
  /** Release the WASM objects. */
  close(): void;
}

/** The part of lcms-wasm we use. The package ships no types. */
interface Lcms {
  cmsOpenProfileFromMem(bytes: Uint8Array, length: number): number;
  cmsCloseProfile(profile: number): void;
  cmsCreateTransform(input: number, inputFormat: number, output: number, outputFormat: number, intent: number, flags: number): number;
  cmsDeleteTransform(transform: number): void;
  cmsDoTransform(transform: number, input: Uint16Array, count: number): Uint16Array;
  cmsGetColorSpaceASCII(profile: number): string | null;
}
interface LcmsModule {
  instantiate(options?: object): Promise<Lcms>;
  TYPE_CMYK_16: number;
  TYPE_RGB_16: number;
  INTENT_RELATIVE_COLORIMETRIC: number;
  cmsFLAGS_BLACKPOINTCOMPENSATION: number;
}

let lcmsPromise: Promise<{ lcms: Lcms; mod: LcmsModule }> | null = null;

function loadLcms() {
  // A dynamic import: lcms-wasm is ESM only, and the Electron main bundle is CommonJS.
  lcmsPromise ??= (async () => {
    // @ts-expect-error TS7016: lcms-wasm ships no types; LcmsModule above is the part we use
    const mod = (await import('lcms-wasm')) as unknown as LcmsModule;
    return { lcms: await mod.instantiate(), mod };
  })();
  return lcmsPromise;
}

function openProfile(lcms: Lcms, file: string, expectSpace: string): number {
  const bytes = fs.readFileSync(file);
  const profile = lcms.cmsOpenProfileFromMem(new Uint8Array(bytes), bytes.length);
  if (!profile) throw new Error(`LittleCMS could not read the ICC profile ${file}`);
  const space = lcms.cmsGetColorSpaceASCII(profile);
  if (space !== expectSpace) throw new Error(`${file} is a ${space} profile, expected ${expectSpace}`);
  return profile;
}

/** Build a CMYK to sRGB transform through the output profile. Throws when a profile cannot be read. */
export async function createSoftProofer(cmykProfilePath: string, srgbProfilePath: string): Promise<SoftProofer> {
  const { lcms, mod } = await loadLcms();
  const cmyk = openProfile(lcms, cmykProfilePath, 'CMYK');
  const srgb = openProfile(lcms, srgbProfilePath, 'RGB');
  const transform = lcms.cmsCreateTransform(cmyk, mod.TYPE_CMYK_16, srgb, mod.TYPE_RGB_16, mod.INTENT_RELATIVE_COLORIMETRIC, mod.cmsFLAGS_BLACKPOINTCOMPENSATION);
  if (!transform) throw new Error('LittleCMS could not build the CMYK to sRGB transform');
  let closed = false;
  return {
    convert(inks) {
      if (closed) throw new Error('This soft proofer has been closed');
      if (inks.length === 0) return [];
      const input = new Uint16Array(inks.length * 4);
      inks.forEach((ink, i) => ink.forEach((v, j) => (input[i * 4 + j] = Math.round((Math.min(100, Math.max(0, v)) / 100) * 65535))));
      const out = lcms.cmsDoTransform(transform, input, inks.length);
      return inks.map((_, i) => [0, 1, 2].map((j) => Math.round((out[i * 3 + j]! / 65535) * 255)) as Rgb8);
    },
    close() {
      if (closed) return;
      closed = true;
      lcms.cmsDeleteTransform(transform);
      lcms.cmsCloseProfile(cmyk);
      lcms.cmsCloseProfile(srgb);
    },
  };
}
