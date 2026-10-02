/** App-supplied exact-file font loader. Standalone render fixtures retain bundled Inter without Electron. */
export interface RequestedFont { family: string; weight: number; style: 'normal' | 'italic' }
export interface LoadedFont extends RequestedFont { url: string; missing: boolean; face: { family: string; styleName: string } }
type FontSource = (requests: RequestedFont[]) => Promise<LoadedFont[]>;
let source: FontSource | undefined;
let epoch = 0;
const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
export function setFontSource(next: FontSource): void {
  source = next; invalidateFonts();
  if (typeof document !== 'undefined' && !observer) {
    observer = new MutationObserver(highlightMissingFonts);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  }
}
export function invalidateFonts(): void { epoch++; for (const l of listeners) l(); }
export const getFontEpoch = () => epoch;
export const subscribeFonts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let loaded: FontFace[] = [];
let key = '';
let sequence = 0;
const missing = new Set<string>();
const faceKey = (face: RequestedFont) => JSON.stringify([face.family.toLowerCase(), face.weight, face.style]);
export function isMissingFont(face: RequestedFont): boolean { return missing.has(faceKey(face)); }
export function parseFontRequest(css: string): RequestedFont {
  const match = css.match(/^(normal|italic) (\d+) [^ ]+ "(.*)"$/);
  if (!match) throw new Error(`Unsupported document font request: ${css}`);
  return { family: match[3]!, weight: Number(match[2]), style: match[1] as RequestedFont['style'] };
}

export async function loadExactFonts(faces: readonly string[]): Promise<void> {
  if (!source) return;
  const id = ++sequence;
  const requests = faces.map(parseFontRequest);
  const bindings = await source(requests);
  if (id !== sequence) return;
  const nextKey = JSON.stringify(bindings);
  if (key === nextKey) { highlightMissingFonts(); return; }
  const next = bindings.map((b) => new FontFace(b.family, `url(${JSON.stringify(b.url)})`, { weight: String(b.weight), style: b.style, display: 'block' }));
  // FontFace.load rejection must remain visible; a press PDF must never silently use a different local font.
  await Promise.all(next.map((face) => face.load()));
  if (id !== sequence) return;
  for (const font of loaded) document.fonts.delete(font);
  next.forEach((font) => document.fonts.add(font));
  loaded = next; key = nextKey;
  missing.clear();
  bindings.filter((b) => b.missing).forEach((b) => missing.add(faceKey(b)));
  highlightMissingFonts();
}

function highlightMissingFonts(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.galley-page[data-color-mode="screen"] .galley-text span')) {
    const css = getComputedStyle(el);
    const family = css.fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    const face = { family, weight: Number(css.fontWeight), style: css.fontStyle as RequestedFont['style'] };
    if (isMissingFont(face)) el.dataset.missingFont = family;
    else delete el.dataset.missingFont;
  }
}
