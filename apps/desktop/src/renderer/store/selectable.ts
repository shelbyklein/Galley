import type { GalleyDocument, Id } from '@galley/model';

/**
 * Can this frame be selected right now? A frame on a hidden or locked layer cannot (as in InDesign). The store applies
 * this whenever the selection changes or the document does, so every way of selecting (tools, the Layers panel, a
 * test) obeys the layer's lock and visibility, and locking a layer drops its frames from the selection.
 */
export function isSelectable(doc: GalleyDocument, id: Id): boolean {
  const frame = doc.frames[id];
  if (!frame) return false;
  const layer = doc.layers[frame.layerId];
  return !!layer && layer.visible && !layer.locked;
}
