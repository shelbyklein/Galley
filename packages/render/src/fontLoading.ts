import { isLayerVisible, paintOrder, paragraphAttrs, resolveParagraph, resolveRun, type GalleyDocument, type Id } from '@galley/model';

/**
 * CSS `font` shorthand strings (`800 16px "Inter"`) for every face the page's visible text can use: the resolved style of each
 * paragraph, and of each run a character style or override mark changes.
 */
export function usedFontFaces(doc: GalleyDocument, pageId: Id): string[] {
  const faces = new Set<string>();
  const add = (r: { fontStyle: string; fontWeight: number; fontFamily: string }) => faces.add(`${r.fontStyle} ${r.fontWeight} 16px "${r.fontFamily}"`);
  for (const frame of paintOrder(doc, pageId)) {
    if (frame.type !== 'text' || !isLayerVisible(doc, frame.layerId)) continue;
    const story = doc.stories[frame.storyId];
    if (!story) continue;
    for (const p of story.doc.content ?? []) {
      const paragraph = resolveParagraph(doc, paragraphAttrs(p));
      add(paragraph);
      for (const run of p.content ?? []) if (run.marks && run.marks.length > 0) add(resolveRun(doc, paragraph, run.marks));
    }
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
