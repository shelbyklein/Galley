/**
 * The `swatch-chart` golden fixture: one Letter page that exercises every ink behavior the export has to get right, laid
 * out so each behavior has a patch or a line of text that no other object covers (the golden checks derive their regions
 * from this geometry). Built with the model's own commands, so it is valid by construction.
 *
 *   top bar            Studio Blue running into the top bleed
 *   rows A, B, C       swatches: process primaries, a CMYK swatch with a tint paint and a saved tint swatch, a spot color at
 *                      full strength, at a paint tint and as a saved tint swatch, a second spot, black at 50%, rich black;
 *                      each with a K-only caption
 *   overprint panels   black overprint and knockout text, blue text and [Paper] text over Warm Orange; black overprint and
 *                      knockout text over PANTONE 185 C
 *   late panels        knockout labels on a teal tint and a spot tint, painted AFTER the overprint objects (no leak)
 *   body text          K-only paragraphs, one at a fractional position
 *   headline           Studio Blue text and PANTONE 185 C text on paper
 *   side bar           Warm Orange running into the left bleed
 */
import {
  addFrame,
  addSwatch,
  applyCommand,
  createDocument,
  createHistory,
  createStory,
  inches,
  paint,
  SWATCH_BLACK,
  SWATCH_PAPER,
  type Frame,
  type GalleyDocument,
  type HistoryState,
  type Id,
  textAttrsToLayers,
  type Swatch,
  type TextAttrs,
} from '@galley/model';

export const CHART_ENGINE_VERSION = '44.5.1';
const LAYER = 'layer_1';
const PAGE = 'page_1';

const SWATCHES: Swatch[] = [
  { id: 'cyan', name: 'Cyan', type: 'cmyk', values: [100, 0, 0, 0] },
  { id: 'magenta', name: 'Magenta', type: 'cmyk', values: [0, 100, 0, 0] },
  { id: 'yellow', name: 'Yellow', type: 'cmyk', values: [0, 0, 100, 0] },
  { id: 'warm-orange', name: 'Warm Orange', type: 'cmyk', values: [0, 60, 100, 0] },
  { id: 'studio-blue', name: 'Studio Blue', type: 'cmyk', values: [100, 80, 0, 20] },
  { id: 'teal', name: 'Teal', type: 'cmyk', values: [85, 10, 40, 10] },
  { id: 'teal-50', name: 'Teal 50%', type: 'tint', baseId: 'teal', percent: 50 },
  { id: 'rich-black', name: 'Rich Black', type: 'cmyk', values: [75, 68, 67, 90] },
  { id: 'pms-185-c', name: 'PANTONE 185 C', type: 'spot', values: [0, 91, 76, 0] },
  { id: 'pms-185-c-40', name: 'PANTONE 185 C 40%', type: 'tint', baseId: 'pms-185-c', percent: 40 },
  { id: 'pms-2995-c', name: 'PANTONE 2995 C', type: 'spot', values: [88, 15, 0, 0] },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rect(h: HistoryState, id: Id, name: string, box: Box, fill: ReturnType<typeof paint> | null, stroke?: { paint: ReturnType<typeof paint>; weight: number }): HistoryState {
  const frame: Frame = { id, type: 'rect', name, layerId: LAYER, ...box, rotation: 0, fill, stroke: stroke ?? null };
  return applyCommand(h, addFrame, { frame, pageId: PAGE });
}

function text(h: HistoryState, id: Id, body: string, box: Box, style: Partial<TextAttrs>, name = ''): HistoryState {
  const frame: Frame = { id, type: 'text', name, layerId: LAYER, ...box, rotation: 0, fill: null, stroke: null, storyId: `story_${id}`, inset: 0 };
  return applyCommand(h, addFrame, { frame, pageId: PAGE, story: createStory(`story_${id}`, body, { overrides: textAttrsToLayers(style) }) });
}

const caption = (h: HistoryState, id: Id, body: string, x: number, y: number): HistoryState =>
  text(h, `cap-${id}`, body, { x, y, w: 80, h: 14 }, { fontSize: 8, leading: 9.75, fill: paint(SWATCH_BLACK) });

export function buildSwatchChart(): GalleyDocument {
  let h = createHistory(
    createDocument({
      title: 'Swatch chart',
      engineVersion: CHART_ENGINE_VERSION,
      page: { id: PAGE, width: inches(8.5), height: inches(11), margins: 36, columns: { count: 1, gutter: 12 }, bleed: inches(0.125), slug: inches(0.5) },
      layer: { id: LAYER, name: 'Layer 1' },
    }),
  );
  for (const swatch of SWATCHES) h = applyCommand(h, addSwatch, { swatch });
  const black = paint(SWATCH_BLACK);
  const blackOverprint = paint(SWATCH_BLACK, 100, true);

  // top bar and side bar: art that runs into the bleed
  h = rect(h, 'top-bar', 'Top bar', { x: -9, y: -9, w: 630, h: 45 }, paint('studio-blue'));
  h = rect(h, 'side-bar', 'Side bar', { x: -9, y: 640, w: 36, h: 100 }, paint('warm-orange'));

  // rows of patches, each with a K-only caption
  const rows: { y: number; patches: [Id, string, ReturnType<typeof paint>][] }[] = [
    {
      y: 72,
      patches: [
        ['cyan', 'Cyan', paint('cyan')],
        ['magenta', 'Magenta', paint('magenta')],
        ['yellow', 'Yellow', paint('yellow')],
        ['black', '[Black] 100K', black],
        ['orange', 'Warm Orange', paint('warm-orange')],
        ['blue', 'Studio Blue', paint('studio-blue')],
      ],
    },
    {
      y: 162,
      patches: [
        ['teal', 'Teal', paint('teal')],
        ['teal-tint', 'Teal, paint at 50%', paint('teal', 50)],
        ['teal-swatch', 'Teal 50% swatch', paint('teal-50')],
        ['pms', 'PANTONE 185 C', paint('pms-185-c')],
        ['pms-tint', '185 C, paint at 40%', paint('pms-185-c', 40)],
        ['pms-swatch', '185 C 40% swatch', paint('pms-185-c-40')],
      ],
    },
    {
      y: 252,
      patches: [
        ['pms2', 'PANTONE 2995 C', paint('pms-2995-c')],
        ['pms2-tint', '2995 C, paint at 70%', paint('pms-2995-c', 70)],
        ['gray', '[Black] at 50%', paint(SWATCH_BLACK, 50)],
        ['rich', 'Rich Black', paint('rich-black')],
      ],
    },
  ];
  for (const row of rows) {
    row.patches.forEach(([id, label, fill], i) => {
      const x = 36 + i * 92;
      h = rect(h, `patch-${id}`, label, { x, y: row.y, w: 80, h: 60 }, fill);
      h = caption(h, id, label, x, row.y + 62);
    });
  }

  // overprint panels: black text that overprints and knocks out, over Warm Orange and over a spot color
  const label16: Partial<TextAttrs> = { fontWeight: 800, fontSize: 16, leading: 21 };
  h = rect(h, 'panel-orange', 'Orange panel', { x: 36, y: 340, w: 252, h: 96 }, paint('warm-orange'));
  h = text(h, 'ov-black', 'OVERPRINT', { x: 44, y: 346, w: 112, h: 27 }, { ...label16, fill: blackOverprint }, 'Overprint black on orange');
  h = text(h, 'ko-black', 'KNOCKOUT', { x: 168, y: 346, w: 112, h: 27 }, { ...label16, fill: black }, 'Knockout black on orange');
  h = text(h, 'blue-text', 'Blue text', { x: 44, y: 376, w: 112, h: 27 }, { ...label16, fill: paint('studio-blue') }, 'Studio Blue text on orange');
  h = text(h, 'paper-text', 'Paper text', { x: 168, y: 376, w: 112, h: 27 }, { ...label16, fill: paint(SWATCH_PAPER) }, '[Paper] text on orange');
  h = rect(h, 'panel-spot', 'Spot panel', { x: 300, y: 340, w: 276, h: 96 }, paint('pms-185-c'));
  h = text(h, 'ov-spot', 'SPOT + K overprint', { x: 308, y: 346, w: 260, h: 27 }, { ...label16, fill: blackOverprint }, 'Overprint black on PANTONE 185 C');
  h = text(h, 'ko-spot', 'Knockout on spot', { x: 308, y: 376, w: 260, h: 27 }, { ...label16, fill: black }, 'Knockout black on PANTONE 185 C');

  // painted after the overprint objects: knockout labels must not inherit their overprint state
  h = rect(h, 'late-teal', 'Late teal tint', { x: 36, y: 452, w: 252, h: 60 }, paint('teal', 50));
  h = text(h, 'late-teal-text', 'Knockout label', { x: 44, y: 462, w: 236, h: 27 }, { ...label16, fill: black }, 'Knockout black on teal 50%');
  h = rect(h, 'late-spot', 'Late spot tint', { x: 300, y: 452, w: 276, h: 60 }, paint('pms-185-c', 40));
  h = text(h, 'late-spot-text', 'Knockout label', { x: 308, y: 462, w: 260, h: 27 }, { ...label16, fill: black }, 'Knockout black on PANTONE 185 C 40%');

  // K-only body text, one frame on whole pixels and one at fractional positions
  const body = 'Twenty studios open their doors for one day. Watch screen printing, letterpress and riso demos, browse prints, and meet the people who make them.';
  h = text(h, 'body-1', body, { x: 36, y: 530, w: 252, h: 96 }, { fontSize: 11, leading: 16.5, fill: black }, 'Body text');
  h = text(h, 'body-2', body, { x: 300.3, y: 530.1, w: 276.1, h: 96 }, { fontSize: 11, leading: 16.5, fill: black }, 'Body text, fractional position');

  // colored text on paper
  h = text(h, 'head-blue', 'Studio Blue headline', { x: 36, y: 640, w: 400, h: 40 }, { fontWeight: 800, fontSize: 26, leading: 30, fill: paint('studio-blue') }, 'Studio Blue text on paper');
  h = text(h, 'head-spot', 'PANTONE 185 C text', { x: 36, y: 690, w: 400, h: 40 }, { fontWeight: 800, fontSize: 26, leading: 30, fill: paint('pms-185-c') }, 'PANTONE 185 C text on paper');
  return h.doc;
}
