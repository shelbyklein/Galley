/**
 * Helpers for the canvas and tool unit tests: a document with one page and one layer, and frame builders. Test-only
 * (not imported by app code).
 */
import { addFrame, applyCommand, createDocument, createHistory, createStory, paint, SWATCH_BLACK, type Frame, type GalleyDocument, type HistoryState, type RectFrame } from '@galley/model';

export const PAGE = 'page_1';
export const LAYER = 'layer_1';

export function blank(page: Parameters<typeof createDocument>[0]['page'] = {}): GalleyDocument {
  return createDocument({ title: 'Test', engineVersion: 'test', page: { id: PAGE, width: 612, height: 792, margins: 36, ...page }, layer: { id: LAYER } });
}

export const rect = (id: string, x: number, y: number, w: number, h: number, props: Partial<RectFrame> = {}): RectFrame => ({
  id,
  type: 'rect',
  name: '',
  layerId: LAYER,
  x,
  y,
  w,
  h,
  rotation: 0,
  fill: paint(SWATCH_BLACK),
  stroke: null,
  ...props,
});

/** Add frames to the page (and a story for each text frame) and return the new history. */
export function withFrames(frames: Frame[], doc: GalleyDocument = blank()): HistoryState {
  let h = createHistory(doc);
  for (const frame of frames) {
    h = applyCommand(h, addFrame, { frame, pageId: PAGE, story: frame.type === 'text' ? createStory(frame.storyId, 'Hello') : undefined });
  }
  return h;
}
