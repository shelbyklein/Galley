// Output profile discovery. No profile is bundled with Galley (they are licensed, and this repository is public): the
// output profile is read from the system.
//
//   preferred  Adobe's Coated GRACoL 2006 (CGATS TR 006), if the Adobe color folder has it
//   fallback   Ghostscript's default_cmyk.icc, which ships with Ghostscript (found under its share directory)
//
// The result says which one was chosen and why, so the status bar and the export dialog can tell the user when it is
// the fallback. sRGB for photos and the screen comes from macOS ColorSync.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutputIntentSpec } from './pdfx.ts';

export const GRACOL_FILE = 'CoatedGRACoL2006.icc';
export const ADOBE_PROFILE_DIRS = ['/Library/Application Support/Adobe/Color/Profiles/Recommended', path.join(os.homedir(), 'Library/Application Support/Adobe/Color/Profiles/Recommended')];
export const SRGB_PROFILE_PATHS = ['/System/Library/ColorSync/Profiles/sRGB Profile.icc', '/Library/ColorSync/Profiles/sRGB Profile.icc'];

/** Environment overrides, used by tests: a `:`-separated list of folders searched for `CoatedGRACoL2006.icc`, and the Ghostscript iccprofiles folder. */
export const ENV_PROFILE_DIRS = 'GALLEY_PROFILE_DIRS';
export const ENV_GS_ICC_DIR = 'GALLEY_GS_ICC_DIR';

export interface OutputProfile {
  /** Absolute path of the ICC file. */
  path: string;
  /** `press` is the real press condition; `fallback` is Ghostscript's generic CMYK profile. */
  kind: 'press' | 'fallback';
  /** What the status bar calls it. */
  name: string;
  /** The PDF/X-4 OutputIntent entries for this profile. */
  intent: Omit<OutputIntentSpec, 'profilePath'>;
}

export interface ProfileSelection {
  /** The CMYK output profile, or null when neither the preferred nor the fallback profile exists. */
  output: OutputProfile | null;
  /** The sRGB display profile, or null. */
  srgbPath: string | null;
  /** One sentence for the user when this is not the preferred setup (fallback in use, or no profile at all). */
  note: string | null;
}

/** True when the file is an ICC profile for CMYK (header signature `acsp`, data colour space `CMYK`). */
export function isCmykProfile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(40);
      const n = fs.readSync(fd, head, 0, 40, 0);
      return n === 40 && head.toString('latin1', 36, 40) === 'acsp' && head.toString('latin1', 16, 20) === 'CMYK';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function existingFile(candidates: string[]): string | null {
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Where Ghostscript keeps `iccprofiles/` (Homebrew on Apple Silicon and Intel, or a system install). */
export function ghostscriptIccDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  if (env[ENV_GS_ICC_DIR]) dirs.push(env[ENV_GS_ICC_DIR]!);
  for (const prefix of ['/opt/homebrew', '/usr/local', '/usr']) dirs.push(path.join(prefix, 'share/ghostscript/iccprofiles'));
  for (const cellar of ['/opt/homebrew/Cellar/ghostscript', '/usr/local/Cellar/ghostscript']) {
    try {
      for (const version of fs.readdirSync(cellar).sort().reverse()) dirs.push(path.join(cellar, version, 'share/ghostscript/iccprofiles'));
    } catch {
      /* no Homebrew Ghostscript here */
    }
  }
  return dirs;
}

export function selectProfiles(env: NodeJS.ProcessEnv = process.env): ProfileSelection {
  const srgbPath = existingFile(SRGB_PROFILE_PATHS);
  const dirs = env[ENV_PROFILE_DIRS] !== undefined ? env[ENV_PROFILE_DIRS]!.split(':').filter(Boolean) : ADOBE_PROFILE_DIRS;

  const gracol = existingFile(dirs.map((d) => path.join(d, GRACOL_FILE)));
  if (gracol && isCmykProfile(gracol)) {
    return {
      output: {
        path: gracol,
        kind: 'press',
        name: 'Coated GRACoL 2006',
        intent: {
          identifier: 'CGATS TR 006',
          condition: 'Coated GRACoL 2006 (ISO 12647-2:2004)',
          registry: 'http://www.color.org',
          info: 'Coated GRACoL 2006 (ISO 12647-2:2004), sheetfed offset, coated paper',
        },
      },
      srgbPath,
      note: null,
    };
  }

  const fallback = existingFile(ghostscriptIccDirs(env).map((d) => path.join(d, 'default_cmyk.icc')));
  if (fallback && isCmykProfile(fallback)) {
    return {
      output: {
        path: fallback,
        kind: 'fallback',
        name: 'Ghostscript default CMYK',
        intent: {
          identifier: 'Ghostscript default_cmyk',
          condition: 'Ghostscript default CMYK (generic; no press profile was found)',
          registry: '',
          info: 'Generic CMYK profile from Ghostscript, used because Coated GRACoL 2006 is not installed',
        },
      },
      srgbPath,
      note: 'Coated GRACoL 2006 was not found, so Galley is using Ghostscript’s generic default_cmyk.icc. Colors on screen and the PDF/X output intent are approximate.',
    };
  }

  return {
    output: null,
    srgbPath,
    note: 'No CMYK output profile was found (Adobe’s Coated GRACoL 2006 or Ghostscript’s default_cmyk.icc). Colors on screen are approximate, and PDF/X-4 export is unavailable. Install Ghostscript (brew install ghostscript).',
  };
}
