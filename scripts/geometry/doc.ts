// The document `npm run test:geometry` exports: shapes, text frames and an image frame at fractional point positions, with
// the numbers the PDF must reproduce. Built with the model's own commands, so it is valid by construction.
import {
  addAsset,
  addFrame,
  applyCommand,
  createDocument,
  createHistory,
  createStory,
  paint,
  SWATCH_BLACK,
  type Frame,
  type GalleyDocument,
  type HistoryState,
  type Id,
} from '@galley/model';

export const GEO_PAGE = { id: 'page_1', width: 612, height: 792, bleed: 9, slug: 36 } as const;
/** Where the page's (0, 0) is on the sheet: the slug (36 pt) is larger than the bleed. */
export const GEO_ORIGIN = { x: 36, y: 36 };
const LAYER = 'layer_1';

export interface TextCase {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  inset: number;
  rotation: number;
  leading: number;
  note: string;
}

export interface ShapeCase {
  id: Id;
  type: 'rect' | 'ellipse' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stroke weight in points, 0 for none. */
  stroke: number;
}

/** Shapes at fractional positions. Fills are checked by their edges, the line by its end points and weight. */
export const SHAPES: ShapeCase[] = [
  { id: 'rect-a', type: 'rect', x: 36.3, y: 99.1, w: 100.1, h: 60.1, stroke: 0 },
  { id: 'rect-b', type: 'rect', x: 150.37, y: 100.13, w: 33.37, h: 20.11, stroke: 0 },
  { id: 'rect-c', type: 'rect', x: 200.55, y: 100.77, w: 90.3, h: 40.4, stroke: 0 },
  { id: 'ellipse-a', type: 'ellipse', x: 300.25, y: 99.9, w: 90.3, h: 40.4, stroke: 0 },
  { id: 'line-a', type: 'line', x: 36.3, y: 180.5, w: 200.1, h: 0, stroke: 0.25 },
  { id: 'rect-hairline', type: 'rect', x: 36.3, y: 190.6, w: 200.1, h: 0.25, stroke: 0 },
];

/**
 * Text frames: Inter 400, 12 pt on 18 pt leading (a multiple of 0.75 pt, so lines land on whole pixels), black. The first
 * one sits on whole CSS pixels (36 pt = 48 px, 99 pt = 132 px) and is the reference for the baseline offset inside a frame.
 */
export const TEXTS: TextCase[] = [
  { id: 'text-ref', x: 36, y: 399, w: 100, h: 60, inset: 0, rotation: 0, leading: 18, note: 'whole CSS pixels (reference)' },
  { id: 'text-a', x: 36.3, y: 399.1, w: 100.1, h: 60.1, inset: 0, rotation: 0, leading: 18, note: 'x 36.3, w 100.1' },
  { id: 'text-b', x: 150.37, y: 400.13, w: 100.1, h: 60.1, inset: 0, rotation: 0, leading: 18, note: 'x 150.37, y 400.13' },
  { id: 'text-c', x: 270.55, y: 400.77, w: 90.3, h: 40.4, inset: 0, rotation: 0, leading: 18, note: 'x 270.55, y 400.77' },
  { id: 'text-d', x: 36.33, y: 480.01, w: 150.25, h: 30, inset: 0, rotation: 0, leading: 18, note: 'y 480.01' },
  { id: 'text-e', x: 200.61, y: 480.99, w: 150.25, h: 30, inset: 0, rotation: 0, leading: 18, note: 'y 480.99' },
  { id: 'text-rot', x: 400.2, y: 400.4, w: 90, h: 30, inset: 0, rotation: 12.5, leading: 18, note: 'rotated 12.5 degrees' },
  // documented, not asserted to 0.05: how Chromium places a baseline inside a frame
  { id: 'text-inset', x: 36.3, y: 560.1, w: 150, h: 40, inset: 3.6, rotation: 0, leading: 18, note: 'inset 3.6 pt (4.8 px)' },
  { id: 'text-lead13', x: 200.3, y: 560.1, w: 150, h: 40, inset: 0, rotation: 0, leading: 13, note: 'leading 13 pt (17.33 px)' },
];

export interface ImageCase {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The picture's rectangle inside the frame. */
  content: { x: number; y: number; w: number; h: number };
}
export const IMAGES: ImageCase[] = [
  { id: 'image-a', x: 36.3, y: 640.1, w: 200.1, h: 106.7, content: { x: -3.3, y: -2.2, w: 300.15, h: 160.05 } },
];

const asset = { id: 'photo', kind: 'image' as const, path: 'assets/photo.jpg', hash: 'sha256:' + '0'.repeat(64), width: 2400, height: 1280, ppi: 300, colorSpace: 'rgb' as const };

function frame({ id, x, y, w, h }: { id: Id; x: number; y: number; w: number; h: number }, rest: object): Frame {
  return { name: '', layerId: LAYER, rotation: 0, fill: null, stroke: null, id, x, y, w, h, ...rest } as Frame;
}

export function buildGeometryDoc(): GalleyDocument {
  let h: HistoryState = createHistory(
    createDocument({
      title: 'Geometry',
      engineVersion: '44.5.1',
      page: { ...GEO_PAGE, margins: 36 },
      layer: { id: LAYER },
    }),
  );
  h = applyCommand(h, addAsset, { asset });
  for (const s of SHAPES) {
    const stroke = s.stroke > 0 ? { paint: paint(SWATCH_BLACK), weight: s.stroke } : null;
    h = applyCommand(h, addFrame, {
      pageId: GEO_PAGE.id,
      frame: frame(s, { type: s.type, fill: s.type === 'line' ? null : paint(SWATCH_BLACK), stroke }),
    });
  }
  for (const t of TEXTS) {
    h = applyCommand(h, addFrame, {
      pageId: GEO_PAGE.id,
      frame: frame(t, { type: 'text', rotation: t.rotation, storyId: `story_${t.id}`, inset: t.inset }),
      story: createStory(`story_${t.id}`, 'Hxg', { fontSize: 12, leading: t.leading, fill: paint(SWATCH_BLACK) }),
    });
  }
  for (const i of IMAGES) {
    h = applyCommand(h, addFrame, {
      pageId: GEO_PAGE.id,
      frame: frame(i, { type: 'image', assetId: 'photo', content: i.content }),
    });
  }
  return h.doc;
}
