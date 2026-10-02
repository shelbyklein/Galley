import { isLayerVisible, paintOrder, paragraphAttrs, resolveParagraph, resolveRun, type GalleyDocument } from '@galley/model';
import type { FontRequest } from './types';
/** Every resolved visible paragraph/run face on a page, including character style overrides. */
export function documentFontRequests(doc: GalleyDocument, pageId: string): FontRequest[] {
  const fonts = new Map<string, FontRequest>();
  const add = (r: { fontFamily: string; fontWeight: number; fontStyle: 'normal' | 'italic' }) => {
    const face = { family: r.fontFamily, weight: r.fontWeight, style: r.fontStyle };
    fonts.set(JSON.stringify(face), face);
  };
  for (const frame of paintOrder(doc, pageId)) {
    if (frame.type !== 'text' || !isLayerVisible(doc, frame.layerId)) continue;
    for (const p of doc.stories[frame.storyId]?.doc.content ?? []) {
      const paragraph = resolveParagraph(doc, paragraphAttrs(p)); add(paragraph);
      for (const run of p.content ?? []) if (run.marks?.length) add(resolveRun(doc, paragraph, run.marks));
    }
  }
  return [...fonts.values()];
}
