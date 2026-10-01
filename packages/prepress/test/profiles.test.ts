import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV_GS_ICC_DIR, ENV_PROFILE_DIRS, GRACOL_FILE, isCmykProfile, selectProfiles } from '../src/profiles';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-profiles-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** The 128-byte header of an ICC profile is enough for `isCmykProfile`: 'acsp' at 36 and the colour space at 16. */
function fakeProfile(file: string, space = 'CMYK'): void {
  const b = Buffer.alloc(128);
  b.write(space.padEnd(4), 16, 'latin1');
  b.write('acsp', 36, 'latin1');
  fs.writeFileSync(file, b);
}

describe('selectProfiles', () => {
  it('prefers Adobe’s Coated GRACoL 2006 and says nothing about it', () => {
    const adobe = tmp();
    fakeProfile(path.join(adobe, GRACOL_FILE));
    const s = selectProfiles({ [ENV_PROFILE_DIRS]: adobe, [ENV_GS_ICC_DIR]: tmp() });
    expect(s.output).toMatchObject({ kind: 'press', name: 'Coated GRACoL 2006', path: path.join(adobe, GRACOL_FILE) });
    expect(s.output!.intent.identifier).toBe('CGATS TR 006');
    expect(s.note).toBeNull();
  });

  it('falls back to Ghostscript’s default_cmyk.icc, and the note says so', () => {
    const gs = tmp();
    fakeProfile(path.join(gs, 'default_cmyk.icc'));
    const s = selectProfiles({ [ENV_PROFILE_DIRS]: tmp(), [ENV_GS_ICC_DIR]: gs });
    expect(s.output).toMatchObject({ kind: 'fallback', name: 'Ghostscript default CMYK', path: path.join(gs, 'default_cmyk.icc') });
    expect(s.note).toMatch(/GRACoL 2006 was not found/);
    expect(s.note).toMatch(/default_cmyk\.icc/);
  });

  it('ignores a file that is not a CMYK ICC profile', () => {
    const adobe = tmp();
    fakeProfile(path.join(adobe, GRACOL_FILE), 'RGB');
    expect(isCmykProfile(path.join(adobe, GRACOL_FILE))).toBe(false);
    const gs = tmp();
    fakeProfile(path.join(gs, 'default_cmyk.icc'));
    expect(selectProfiles({ [ENV_PROFILE_DIRS]: adobe, [ENV_GS_ICC_DIR]: gs }).output?.kind).toBe('fallback');
  });

  it('reports no profile at all rather than guessing, when the only candidates are missing', () => {
    // searches only the given folders plus the real Ghostscript install; a machine without Ghostscript returns null
    const s = selectProfiles({ [ENV_PROFILE_DIRS]: tmp(), [ENV_GS_ICC_DIR]: tmp() });
    if (s.output === null) expect(s.note).toMatch(/No CMYK output profile/);
    else expect(s.output.kind).toBe('fallback');
  });
});
