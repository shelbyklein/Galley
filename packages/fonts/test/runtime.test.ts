// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { loadExactFonts, setFontSource, isMissingFont, type LoadedFont } from '../../render/src/fontRuntime';

test('a late font resolution cannot replace the current document font files or missing-font state', async () => {
  const installed = new Set<FontFace>();
  Object.defineProperty(document, 'fonts', { configurable: true, value: installed });
  class Face {
    status = 'loaded'; constructor(readonly family: string, readonly source: string) {}
    async load() { return this as unknown as FontFace; }
  }
  vi.stubGlobal('FontFace', Face);
  const resolve = new Map<string, (bindings: LoadedFont[]) => void>();
  setFontSource((requests) => new Promise((done) => resolve.set(requests[0]!.family, done)));
  const older = loadExactFonts(['normal 400 16px "Old"']);
  const newer = loadExactFonts(['normal 400 16px "Current"']);
  const binding = (family: string, missing: boolean): LoadedFont => ({ family, weight: 400, style: 'normal', missing, url: `galley-font://face/${family}`, face: { family: 'Inter', styleName: 'Regular' } });
  resolve.get('Current')!([binding('Current', false)]); await newer;
  resolve.get('Old')!([binding('Old', true)]); await older;
  expect([...installed].map((font) => font.family)).toEqual(['Current']);
  expect(isMissingFont({ family: 'Old', weight: 400, style: 'normal' })).toBe(false);
  vi.unstubAllGlobals();
});
