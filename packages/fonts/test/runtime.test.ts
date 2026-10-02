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

test('bundled CSS keeps its subset fallback chain while document fonts and missing aliases remain exact managed faces', async () => {
  const installed = Object.assign(new Set<FontFace>(), { load: vi.fn().mockResolvedValue([{ family: 'Inter', status: 'loaded' }]) });
  Object.defineProperty(document, 'fonts', { configurable: true, value: installed });
  class Face {
    constructor(readonly family: string, readonly source: string) {}
    async load() { return this as unknown as FontFace; }
  }
  vi.stubGlobal('FontFace', Face);
  setFontSource(async requests => requests.map(request => ({ ...request, url: `galley-font://face/${request.family}`, missing: request.family === 'Missing',
    face: { family: request.family === 'Missing' ? 'Inter' : request.family, styleName: 'Regular', source: request.family === 'Roboto' ? 'document' : 'bundled' } })));
  await loadExactFonts(['normal 400 16px "Inter"', 'normal 400 16px "Roboto"', 'normal 400 16px "Missing"']);
  expect([...installed].map(font => font.family)).toEqual(['Roboto', 'Missing']);
  expect(installed.load).toHaveBeenCalledWith('normal 400 16px "Inter"');
  expect(isMissingFont({ family: 'Missing', weight: 400, style: 'normal' })).toBe(true);
  installed.load.mockRejectedValueOnce(new Error('CSS font unavailable'));
  await expect(loadExactFonts(['italic 700 16px "Inter"'])).rejects.toThrow('CSS font unavailable');
  vi.unstubAllGlobals();
});
