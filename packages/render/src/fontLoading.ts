import { isLayerVisible, paintOrder, type GalleyDocument, type Id } from '@galley/model';

/** CSS `font` shorthand strings (`800 16px "Inter"`) for every face the page's visible text can use. */
export function usedFontFaces(doc: GalleyDocument, pageId: Id): string[] {
  const faces = new Set<string>();
  for (const frame of paintOrder(doc, pageId)) {
    if (frame.type !== 'text' || !isLayerVisible(doc, frame.layerId)) continue;
    const story = doc.stories[frame.storyId];
    if (!story) continue;
    const { fontFamily, fontWeight, fontStyle } = story.defaults;
    const marks = new Set<string>();
    for (const p of story.doc.content ?? []) for (const t of p.content ?? []) for (const m of t.marks ?? []) marks.add(m.type);
    const weights = new Set<number>([fontWeight]);
    if (marks.has('strong')) weights.add(bolder(fontWeight));
    const styles = new Set<string>([fontStyle]);
    if (marks.has('em')) styles.add('italic');
    for (const w of weights) for (const s of styles) faces.add(`${s} ${w} 16px "${fontFamily}"`);
  }
  return [...faces].sort();
}

/** What CSS `font-weight: bolder` resolves to (CSS Fonts 4, section 2.2.1). */
export function bolder(weight: number): number {
  return weight < 350 ? 400 : weight < 550 ? 700 : 900;
}

/** Image URLs on the page, for preloading. */
export function usedImageUrls(doc: GalleyDocument, pageId: Id, assetUrl: (asset: GalleyDocument['assets'][string]) => string): string[] {
  const urls = new Set<string>();
  for (const frame of paintOrder(doc, pageId)) {
    if (frame.type !== 'image' || frame.assetId === null || !isLayerVisible(doc, frame.layerId)) continue;
    const asset = doc.assets[frame.assetId];
    if (asset) urls.add(assetUrl(asset));
  }
  return [...urls].sort();
}

/** Load the faces and decode the images. Resolves when everything that will draw is ready (failures do not block). */
export async function loadPageResources(faces: readonly string[], imageUrls: readonly string[]): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const fonts = (globalThis as { document?: Document }).document?.fonts;
  if (fonts) for (const face of faces) tasks.push(fonts.load(face).catch(() => undefined));
  for (const url of imageUrls) {
    const img = new Image();
    img.src = url;
    tasks.push(img.decode().catch(() => undefined));
  }
  await Promise.all(tasks);
}
