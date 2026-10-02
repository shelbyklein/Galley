/**
 * A random command generator for the model's property tests. Given the current document, it picks a command and builds
 * arguments from objects that exist (and, now and then, deliberately invalid ones, which must be rejected without a
 * trace). Every command in `allCommands` must be reachable from here: the test at the bottom of random.test.ts fails
 * if a new command is added to the model without a generator.
 */
import {
  allCommands,
  BASIC_PARAGRAPH_ID,
  BUILTIN_SWATCH_IDS,
  createStory,
  makeLayer,
  makePage,
  paint,
  parentOf,
  pageIdOf,
  paragraphText,
  storyDocFromText,
  textWrapSchema,
  type CommandDef,
  type Frame,
  type GalleyDocument,
  type Id,
  type Paint,
  type StoryRange,
  type Swatch,
  type TextWrap,
} from '../src';
import { imageAsset, type Rng } from './helpers';

export interface RandomCommand {
  /** Key in `allCommands`. */
  key: keyof typeof allCommands;
  command: CommandDef<any>;
  args: unknown;
}

const WORDS = ['Spring', 'open', 'studio', 'press', 'ink', 'plate', 'bleed', 'trim', 'flyer', 'poster'];

export function randomText(r: Rng): string {
  const lines = r.int(1, 3);
  return Array.from({ length: lines }, () => Array.from({ length: r.int(1, 6) }, () => r.pick(WORDS)).join(' ')).join('\n');
}

function randomPaint(doc: GalleyDocument, r: Rng): Paint {
  return paint(r.pick(doc.swatchOrder), r.chance(0.7) ? 100 : r.int(0, 100), r.chance(0.15));
}

function randomWrap(r: Rng): TextWrap {
  const off = () => r.int(0, 18);
  const wrap = r.pick([
    { mode: 'none' },
    { mode: 'boundingBox', offsets: { top: off(), right: off(), bottom: off(), left: off() } },
    { mode: 'contour', offset: off() },
  ] as TextWrap[]);
  return textWrapSchema.parse(wrap);
}

const frames = (doc: GalleyDocument): Frame[] => Object.values(doc.frames);
const topLevel = (doc: GalleyDocument): Frame[] => frames(doc).filter((f) => parentOf(doc, f.id) === null);

let counter = 0;
const uid = (prefix: string, r: Rng) => `${prefix}_${r.int(0, 1e9).toString(36)}_${counter++}`;

function newFrame(doc: GalleyDocument, r: Rng): { args: unknown } {
  const pageId = r.pick(doc.pageOrder);
  const layerId = r.pick(doc.layerOrder);
  const type = r.pick(['rect', 'ellipse', 'line', 'text', 'text', 'text', 'image'] as const);
  const id = uid('frm', r);
  const box = {
    x: r.float(-20, 500),
    y: r.float(-20, 700),
    w: r.float(1, 300),
    h: type === 'line' ? 0 : r.float(1, 300),
    rotation: r.chance(0.3) ? r.float(-180, 180) : 0,
    fill: r.chance(0.6) ? randomPaint(doc, r) : null,
    stroke: r.chance(0.4) ? { paint: randomPaint(doc, r), weight: r.float(0, 12) } : null,
    ...(r.chance(0.2) ? { textWrap: randomWrap(r) } : {}),
  };
  let frame: Frame;
  let story;
  if (type === 'text') {
    const storyId = uid('sty', r);
    frame = { id, type, name: '', layerId, ...box, storyId, inset: r.chance(0.3) ? r.float(0, 10) : 0 };
    story = createStory(storyId, r.chance(0.3) ? '' : randomText(r), {
      style: r.pick(doc.paragraphStyleOrder),
      ...(r.chance(0.3) ? { overrides: { shared: { fill: randomPaint(doc, r) }, print: { fontSize: r.int(6, 40), leading: r.int(8, 48) } } } : {}),
    });
  } else if (type === 'image') {
    const assets = Object.keys(doc.assets);
    const withAsset = assets.length > 0 && r.chance(0.7);
    frame = {
      id,
      type,
      name: '',
      layerId,
      ...box,
      assetId: withAsset ? r.pick(assets) : null,
      content: withAsset ? { x: 0, y: 0, w: box.w, h: box.h } : null,
    };
  } else {
    frame = { id, type, name: '', layerId, ...box };
  }
  // sometimes put the new frame inside an existing group on the same page and layer
  const groups = frames(doc).filter((f) => f.type === 'group' && f.layerId === layerId && pageIdOf(doc, f.id) === pageId);
  const parentId = groups.length > 0 && r.chance(0.25) ? r.pick(groups).id : null;
  const container = parentId ? (doc.frames[parentId] as Extract<Frame, { type: 'group' }>).childIds.length : doc.pages[pageId]!.items.length;
  return { args: { frame, pageId, parentId, story, index: r.chance(0.4) ? r.int(0, container) : undefined } };
}

type Maker = (doc: GalleyDocument, r: Rng) => { key: keyof typeof allCommands; args: unknown } | null;


const textFrames = (doc: GalleyDocument) => frames(doc).filter((f): f is Extract<Frame, { type: 'text' }> => f.type === 'text');

/** A random range inside a story (sometimes collapsed, sometimes reversed, rarely out of range so the command must reject it). */
function randomRange(doc: GalleyDocument, storyId: Id, r: Rng): StoryRange {
  const paragraphs = doc.stories[storyId]!.doc.content ?? [];
  const point = () => {
    const paragraph = r.int(0, paragraphs.length - 1);
    return { paragraph, offset: r.int(0, paragraphText(paragraphs[paragraph]!).length) };
  };
  const range = { from: point(), to: point() };
  if (r.chance(0.04)) range.to = { ...range.to, offset: range.to.offset + 999 };
  if (r.chance(0.3)) range.to = range.from;
  return range;
}

function randomLayers(doc: GalleyDocument, r: Rng, kind: 'paragraph' | 'character') {
  const shared: Record<string, unknown> = {};
  const print: Record<string, unknown> = {};
  if (r.chance(0.5)) shared.fontWeight = r.pick([300, 400, 500, 700, 800]);
  if (r.chance(0.3)) shared.fontStyle = r.pick(['normal', 'italic'] as const);
  if (r.chance(0.3)) shared.tracking = r.int(-50, 100);
  if (r.chance(0.3)) shared.fill = randomPaint(doc, r);
  if (r.chance(0.15)) shared.features = { liga: r.chance(0.5), onum: r.chance(0.5) };
  if (r.chance(0.15)) shared.textCase = r.pick(['normal', 'allCaps', 'smallCaps'] as const);
  if (r.chance(0.5)) print.fontSize = r.int(6, 48);
  if (r.chance(0.4)) print.leading = r.float(8, 60);
  if (kind === 'paragraph') {
    if (r.chance(0.4)) print.align = r.pick(['left', 'center', 'right', 'justify'] as const);
    if (r.chance(0.3)) print.firstLineIndent = r.int(-6, 24);
    if (r.chance(0.3)) print.spaceAfter = r.int(0, 12);
    if (r.chance(0.2)) print.hyphenate = r.chance(0.5);
    if (r.chance(0.2)) print.hyphenMinWord = r.chance(0.3) ? null : r.int(3, 8);
    if (r.chance(0.2)) print.alignToBaselineGrid = r.chance(0.5);
    if (r.chance(0.1)) shared.role = r.pick(['body', 'heading', 'caption', null] as const);
  } else if (r.chance(0.3)) print.baselineShift = r.int(-4, 6);
  const web = r.chance(0.15) ? { fontSize: '1rem', lineHeight: '1.5', tag: 'p' } : {};
  return { shared, print, web };
}

const styleMakers: Record<string, { weight: number; make: Maker }> = {
  addStyle: {
    weight: 3,
    make: (doc, r) => {
      const kind = r.pick(['paragraph', 'character'] as const);
      const order = kind === 'paragraph' ? doc.paragraphStyleOrder : doc.characterStyleOrder;
      const id = uid(kind === 'paragraph' ? 'pst' : 'cst', r);
      const style = { id, name: `Style ${id}`, basedOn: r.chance(0.2) ? null : r.pick(order), ...randomLayers(doc, r, kind) };
      return { key: 'addStyle', args: { kind, style, index: r.chance(0.3) ? r.int(0, order.length) : undefined } };
    },
  },
  setStyle: {
    weight: 3,
    make: (doc, r) => {
      const kind = r.pick(['paragraph', 'character'] as const);
      const table = kind === 'paragraph' ? doc.paragraphStyles : doc.characterStyles;
      const order = kind === 'paragraph' ? doc.paragraphStyleOrder : doc.characterStyleOrder;
      const pool = r.chance(0.95) ? order.filter((id) => id !== BASIC_PARAGRAPH_ID && id !== 'none') : order;
      if (pool.length === 0) return null;
      const current = table[r.pick(pool)]!;
      // based on any style, so some choices close a cycle and the command has to refuse them
      const builtin = current.id === BASIC_PARAGRAPH_ID || current.id === 'none';
      const basedOn = builtin || r.chance(0.2) ? null : r.pick(order);
      const style = { ...current, basedOn, name: r.chance(0.3) ? `Renamed ${counter++}` : current.name, ...(r.chance(0.8) ? randomLayers(doc, r, kind) : {}) };
      return { key: 'setStyle', args: { kind, style } };
    },
  },
  moveStyle: {
    weight: 1,
    make: (doc, r) => {
      const kind = r.pick(['paragraph', 'character'] as const);
      const order = kind === 'paragraph' ? doc.paragraphStyleOrder : doc.characterStyleOrder;
      return { key: 'moveStyle', args: { kind, id: r.pick(order), index: r.int(0, order.length - 1) } };
    },
  },
  removeStyle: {
    weight: 2,
    make: (doc, r) => {
      const kind = r.pick(['paragraph', 'character'] as const);
      const order = kind === 'paragraph' ? doc.paragraphStyleOrder : doc.characterStyleOrder;
      const pool = r.chance(0.95) ? order.filter((id) => id !== BASIC_PARAGRAPH_ID && id !== 'none') : order;
      if (pool.length === 0) return null;
      const replacementId = r.chance(0.2) ? undefined : r.chance(0.3) ? null : r.pick(order);
      return { key: 'removeStyle', args: { kind, id: r.pick(pool), replacementId } };
    },
  },
};

const storyMakers: Record<string, { weight: number; make: Maker }> = {
  setStoryDoc: {
    weight: 3,
    make: (doc, r) => {
      const ids = Object.keys(doc.stories);
      return ids.length === 0 ? null : { key: 'setStoryDoc', args: { storyId: r.pick(ids), doc: storyDocFromText(randomText(r), { style: r.pick(doc.paragraphStyleOrder) }) } };
    },
  },
  applyParagraphStyle: {
    weight: 3,
    make: (doc, r) => {
      const ids = Object.keys(doc.stories);
      if (ids.length === 0) return null;
      const storyId = r.pick(ids);
      return { key: 'applyParagraphStyle', args: { storyId, range: randomRange(doc, storyId, r), styleId: r.chance(0.97) ? r.pick(doc.paragraphStyleOrder) : 'ghost', clearOverrides: r.chance(0.3) } };
    },
  },
  applyCharacterStyle: {
    weight: 3,
    make: (doc, r) => {
      const ids = Object.keys(doc.stories);
      if (ids.length === 0) return null;
      const storyId = r.pick(ids);
      return { key: 'applyCharacterStyle', args: { storyId, range: randomRange(doc, storyId, r), styleId: r.chance(0.25) ? null : r.pick(doc.characterStyleOrder) } };
    },
  },
  setTextOverrides: {
    weight: 4,
    make: (doc, r) => {
      const ids = Object.keys(doc.stories);
      if (ids.length === 0) return null;
      const storyId = r.pick(ids);
      const target = r.pick(['paragraph', 'character', 'character'] as const);
      const { shared, print, web } = randomLayers(doc, r, target);
      const set = { shared, print, ...(Object.keys(web).length > 0 ? { web } : {}) };
      const unset = r.chance(0.3) ? { shared: [r.pick(['fontWeight', 'fill', 'tracking'])], print: [r.pick(['fontSize', 'leading'])] } : undefined;
      return { key: 'setTextOverrides', args: { storyId, range: randomRange(doc, storyId, r), target, patch: { set, unset } } };
    },
  },
  clearTextOverrides: {
    weight: 2,
    make: (doc, r) => {
      const ids = Object.keys(doc.stories);
      if (ids.length === 0) return null;
      const storyId = r.pick(ids);
      return { key: 'clearTextOverrides', args: { storyId, range: randomRange(doc, storyId, r), scope: r.pick(['paragraph', 'character', 'all'] as const) } };
    },
  },
};

const threadMakers: Record<string, { weight: number; make: Maker }> = {
  linkFrames: {
    weight: 9,
    make: (doc, r) => {
      const all = textFrames(doc);
      if (all.length < 2) return null;
      // mostly the last frame of one thread and the first frame of another, which is what a user links; sometimes anything at all
      const lasts = all.filter((f) => doc.stories[f.storyId]!.frameIds[doc.stories[f.storyId]!.frameIds.length - 1] === f.id);
      const firsts = all.filter((f) => doc.stories[f.storyId]!.frameIds[0] === f.id);
      const from = r.chance(0.85) && lasts.length > 0 ? r.pick(lasts) : r.pick(all);
      const to = r.chance(0.85) && firsts.length > 0 ? r.pick(firsts) : r.pick(all);
      return { key: 'linkFrames', args: { fromId: from.id, toId: to.id } };
    },
  },
  insertFrameInThread: {
    weight: 6,
    make: (doc, r) => {
      const all = textFrames(doc);
      if (all.length < 2) return null;
      const loose = all.filter((f) => doc.stories[f.storyId]!.frameIds.length === 1);
      const frame = r.chance(0.8) && loose.length > 0 ? r.pick(loose) : r.pick(all);
      return { key: 'insertFrameInThread', args: { frameId: frame.id, targetId: r.pick(all).id, position: r.pick(['before', 'after'] as const) } };
    },
  },
  unlinkFrame: {
    weight: 5,
    make: (doc, r) => {
      const all = textFrames(doc);
      if (all.length === 0) return null;
      const threaded = all.filter((f) => doc.stories[f.storyId]!.frameIds.length > 1);
      const frame = r.chance(0.85) && threaded.length > 0 ? r.pick(threaded) : r.pick(all);
      return { key: 'unlinkFrame', args: { frameId: frame.id, newStoryId: uid('sty', r) } };
    },
  },
  removeFrameFromThread: {
    weight: 5,
    make: (doc, r) => {
      const all = textFrames(doc);
      if (all.length === 0) return null;
      const threaded = all.filter((f) => doc.stories[f.storyId]!.frameIds.length > 1);
      const frame = r.chance(0.85) && threaded.length > 0 ? r.pick(threaded) : r.pick(all);
      return { key: 'removeFrameFromThread', args: { frameId: frame.id, newStoryId: uid('sty', r) } };
    },
  },
};

const makers: Record<string, { weight: number; make: Maker }> = {
  addFrame: { weight: 22, make: (doc, r) => ({ key: 'addFrame', ...newFrame(doc, r) }) },
  removeFrames: {
    weight: 3,
    make: (doc, r) => {
      const all = frames(doc);
      return all.length === 0 ? null : { key: 'removeFrames', args: { ids: r.pickN(all, r.int(1, 3)).map((f) => f.id) } };
    },
  },
  setFrameProps: {
    weight: 8,
    make: (doc, r) => {
      const boxes = frames(doc).filter((f) => f.type !== 'group');
      if (boxes.length === 0) return null;
      const target = r.pick(boxes);
      const props: Record<string, unknown> = {};
      if (r.chance(0.5)) props.x = r.float(-50, 600);
      if (r.chance(0.5)) props.y = r.float(-50, 800);
      if (r.chance(0.4)) props.w = r.float(0, 400);
      if (r.chance(0.4)) props.h = r.float(0, 400);
      if (r.chance(0.3)) props.rotation = r.float(-360, 360);
      if (r.chance(0.3)) props.fill = r.chance(0.2) ? null : randomPaint(doc, r);
      if (r.chance(0.2)) props.stroke = r.chance(0.3) ? null : { paint: randomPaint(doc, r), weight: r.float(0, 10) };
      if (target.type === 'text' && r.chance(0.3)) props.inset = r.float(0, 12);
      if (r.chance(0.2)) props.textWrap = r.chance(0.2) ? null : randomWrap(r);
      if (r.chance(0.1)) props.name = r.pick(WORDS);
      if (target.type === 'image' && r.chance(0.3)) {
        const assets = Object.keys(doc.assets);
        if (assets.length > 0 && r.chance(0.6)) {
          props.assetId = r.pick(assets);
          props.content = { x: r.float(-20, 20), y: r.float(-20, 20), w: r.float(10, 500), h: r.float(10, 500) };
        } else {
          props.assetId = null;
          props.content = null;
        }
      }
      if (Object.keys(props).length === 0) props.x = 1;
      // (sometimes the command rejects: w < 0 handled by the 0 floor above; an unknown prop type is rejected by the type check)
      return { key: 'setFrameProps', args: { ids: [target.id], props } };
    },
  },
  transformFrames: {
    weight: 6,
    make: (doc, r) => {
      const boxes = frames(doc).filter((f) => f.type !== 'group');
      if (boxes.length === 0) return null;
      const changes = r.pickN(boxes, r.int(1, 3)).map((f) => ({
        id: f.id,
        ...(r.chance(0.7) ? { x: r.float(-50, 600), y: r.float(-50, 800) } : {}),
        ...(r.chance(0.5) ? { w: r.float(0, 400) } : {}),
        ...(r.chance(0.3) ? { rotation: r.float(-360, 360) } : {}),
      }));
      return { key: 'transformFrames', args: { changes } };
    },
  },
  moveFrames: {
    weight: 10,
    make: (doc, r) => {
      const all = frames(doc);
      return all.length === 0 ? null : { key: 'moveFrames', args: { ids: r.pickN(all, r.int(1, 3)).map((f) => f.id), dx: r.float(-40, 40), dy: r.float(-40, 40) } };
    },
  },
  reorderFrames: {
    weight: 5,
    make: (doc, r) => {
      const all = frames(doc);
      return all.length === 0 ? null : { key: 'reorderFrames', args: { ids: r.pickN(all, r.int(1, 3)).map((f) => f.id), op: r.pick(['front', 'back', 'forward', 'backward'] as const) } };
    },
  },
  groupFrames: {
    weight: 5,
    make: (doc, r) => {
      const anchor = frames(doc).length > 0 ? r.pick(frames(doc)) : null;
      if (!anchor) return null;
      const siblings = frames(doc).filter((f) => parentOf(doc, f.id) === parentOf(doc, anchor.id) && pageIdOf(doc, f.id) === pageIdOf(doc, anchor.id));
      return { key: 'groupFrames', args: { ids: r.pickN(siblings, r.int(1, 3)).map((f) => f.id), groupId: uid('grp', r) } };
    },
  },
  ungroupFrames: {
    weight: 3,
    make: (doc, r) => {
      const groups = frames(doc).filter((f) => f.type === 'group');
      return groups.length === 0 ? null : { key: 'ungroupFrames', args: { ids: r.pickN(groups, r.int(1, 2)).map((f) => f.id) } };
    },
  },
  moveFramesToLayer: {
    weight: 3,
    make: (doc, r) => {
      const tops = topLevel(doc);
      return tops.length === 0 ? null : { key: 'moveFramesToLayer', args: { ids: r.pickN(tops, r.int(1, 2)).map((f) => f.id), layerId: r.pick(doc.layerOrder) } };
    },
  },
  moveFramesToPage: {
    weight: 3,
    make: (doc, r) => {
      const tops = topLevel(doc);
      return tops.length === 0 ? null : { key: 'moveFramesToPage', args: { ids: r.pickN(tops, r.int(1, 2)).map((f) => f.id), pageId: r.pick(doc.pageOrder), dx: r.float(-100, 100), dy: r.float(-100, 100) } };
    },
  },
  addPage: {
    weight: 2,
    make: (doc, r) => ({
      key: 'addPage',
      args: { page: makePage({ id: uid('page', r), width: r.int(200, 900), height: r.int(200, 1200), margins: r.int(0, 50), bleed: r.chance(0.5) ? 9 : 0, slug: r.chance(0.5) ? 36 : 0 }), index: r.chance(0.5) ? r.int(0, doc.pageOrder.length) : undefined },
    }),
  },
  removePage: { weight: 1, make: (doc, r) => ({ key: 'removePage', args: { id: r.pick(doc.pageOrder) } }) },
  movePage: { weight: 1, make: (doc, r) => ({ key: 'movePage', args: { id: r.pick(doc.pageOrder), index: r.int(0, doc.pageOrder.length - 1) } }) },
  setPageProps: {
    weight: 2,
    make: (doc, r) => ({
      key: 'setPageProps',
      args: { id: r.pick(doc.pageOrder), props: r.chance(0.5) ? { width: r.int(300, 900), height: r.int(300, 1200) } : { bleed: { top: 9, right: 9, bottom: 9, left: 9 }, slug: { top: 36, right: 36, bottom: 36, left: 36 } } },
    }),
  },
  addLayer: {
    weight: 2,
    make: (doc, r) => ({ key: 'addLayer', args: { layer: makeLayer({ id: uid('layer', r), name: `Layer ${r.int(1, 1e6)}-${counter++}` }), index: r.chance(0.5) ? r.int(0, doc.layerOrder.length) : undefined } }),
  },
  removeLayer: { weight: 1, make: (doc, r) => ({ key: 'removeLayer', args: { id: r.pick(doc.layerOrder) } }) },
  setLayerProps: {
    weight: 3,
    make: (doc, r) => ({ key: 'setLayerProps', args: { id: r.pick(doc.layerOrder), props: r.pick([{ visible: r.chance(0.5) }, { locked: r.chance(0.5) }, { name: `L${r.int(0, 1e6)}-${counter++}` }, { color: '#aa33cc' }]) } }),
  },
  moveLayer: { weight: 1, make: (doc, r) => ({ key: 'moveLayer', args: { id: r.pick(doc.layerOrder), index: r.int(0, doc.layerOrder.length - 1) } }) },
  addSwatch: {
    weight: 3,
    make: (doc, r) => {
      const id = uid('sw', r);
      const name = `Swatch ${id}`;
      const bases = Object.values(doc.swatches).filter((s) => s.type !== 'tint');
      const kind = r.pick(['cmyk', 'spot', 'tint'] as const);
      const values = [r.int(0, 100), r.int(0, 100), r.int(0, 100), r.int(0, 100)] as [number, number, number, number];
      const swatch: Swatch = kind === 'tint' ? { id, name, type: 'tint', baseId: r.pick(bases).id, percent: r.int(0, 100) } : { id, name, type: kind, values };
      return { key: 'addSwatch', args: { swatch, index: r.chance(0.3) ? r.int(0, doc.swatchOrder.length) : undefined } };
    },
  },
  setSwatchProps: {
    weight: 3,
    make: (doc, r) => {
      const editable = Object.values(doc.swatches).filter((x) => !BUILTIN_SWATCH_IDS.includes(x.id) || r.chance(0.05));
      if (editable.length === 0) return null;
      const s = r.pick(editable);
      return {
        key: 'setSwatchProps',
        args: { id: s.id, props: s.type === 'tint' ? { percent: r.int(0, 100) } : r.chance(0.5) ? { values: [r.int(0, 100), r.int(0, 100), r.int(0, 100), r.int(0, 100)] } : { name: `Renamed ${counter++}` } },
      };
    },
  },
  removeSwatch: {
    weight: 2,
    make: (doc, r) => {
      const pool = r.chance(0.9) ? doc.swatchOrder.filter((id) => !BUILTIN_SWATCH_IDS.includes(id)) : doc.swatchOrder;
      return pool.length === 0 ? null : { key: 'removeSwatch', args: { id: r.pick(pool), replacementId: r.chance(0.5) ? r.pick(doc.swatchOrder) : null } };
    },
  },
  setBaselineGrid: {
    weight: 1,
    make: (_doc, r) => ({ key: 'setBaselineGrid', args: r.chance(0.8) ? { start: r.int(0, 40), increment: r.pick([9, 12, 13.5, 14.4]) } : { increment: r.pick([0, -3, 12]) } }),
  },
  ...styleMakers,
  ...storyMakers,
  ...threadMakers,
  addGuide: {
    weight: 2,
    make: (doc, r) => ({ key: 'addGuide', args: { guide: { id: uid('gd', r), orientation: r.pick(['horizontal', 'vertical'] as const), position: r.float(-10, 800), pageId: r.pick(doc.pageOrder) } } }),
  },
  moveGuide: {
    weight: 2,
    make: (doc, r) => {
      const ids = Object.keys(doc.guides);
      return ids.length === 0 ? null : { key: 'moveGuide', args: { id: r.pick(ids), position: r.float(-10, 800) } };
    },
  },
  removeGuide: {
    weight: 1,
    make: (doc, r) => {
      const ids = Object.keys(doc.guides);
      return ids.length === 0 ? null : { key: 'removeGuide', args: { id: r.pick(ids) } };
    },
  },
  addAsset: {
    weight: 2,
    make: (_doc, r) => {
      const id = uid('ast', r);
      return { key: 'addAsset', args: { asset: imageAsset(id, { width: r.int(100, 6000), height: r.int(100, 6000), hash: `sha256:${r.int(0, 15).toString(16).repeat(64)}` }) } };
    },
  },
  setAssetProps: {
    weight: 1,
    make: (doc, r) => {
      const ids = Object.keys(doc.assets);
      return ids.length === 0 ? null : { key: 'setAssetProps', args: { id: r.pick(ids), props: { path: `assets/renamed-${counter++}.jpg`, ppi: r.int(72, 600) } } };
    },
  },
  removeAsset: {
    weight: 1,
    make: (doc, r) => {
      const ids = Object.keys(doc.assets);
      return ids.length === 0 ? null : { key: 'removeAsset', args: { id: r.pick(ids) } };
    },
  },
  setMeta: { weight: 1, make: (_doc, r) => ({ key: 'setMeta', args: { title: r.pick(WORDS) } }) },
};

/** Command keys that have a generator; the coverage test compares this with `allCommands`. */
export const generatedCommandKeys = Object.keys(makers);

const weighted = Object.entries(makers).flatMap(([key, m]) => Array<string>(m.weight).fill(key));

/** A random command for this document, or null when the chosen kind has nothing to act on (try again). */
export function randomCommand(doc: GalleyDocument, r: Rng): RandomCommand | null {
  const maker = makers[r.pick(weighted)]!;
  const made = maker.make(doc, r);
  if (!made) return null;
  return { key: made.key, command: allCommands[made.key] as CommandDef<any>, args: made.args };
}

export type { Id };
