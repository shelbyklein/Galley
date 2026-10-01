import {
  applyCommand,
  createDocument,
  createHistory,
  createSequentialIds,
  createStory,
  paint,
  SWATCH_BLACK,
  type AddFrameArgs,
  type Asset,
  type CommandDef,
  type Frame,
  type GalleyDocument,
  type HistoryState,
  type Id,
  type Swatch,
} from '../src';

export const ENGINE = '44.5.1';

/** A document with one 612 x 792 page, one layer, and the built-in swatches plus Orange (cmyk), Spot (spot), Tint (tint of Spot). */
export function baseDoc(): GalleyDocument {
  const doc = createDocument({ title: 'Test', engineVersion: ENGINE, page: { id: 'page_1' }, layer: { id: 'layer_1' } });
  const extra: Swatch[] = [
    { id: 'orange', name: 'Orange', type: 'cmyk', values: [0, 60, 100, 0] },
    { id: 'spot185', name: 'PANTONE 185 C', type: 'spot', values: [0, 91, 76, 0] },
    { id: 'spot185-40', name: 'PANTONE 185 C 40%', type: 'tint', baseId: 'spot185', percent: 40 },
  ];
  for (const s of extra) {
    doc.swatches[s.id] = s;
    doc.swatchOrder.push(s.id);
  }
  return doc;
}

export function history(doc = baseDoc()): HistoryState {
  return createHistory(doc);
}

export function run<A>(h: HistoryState, command: CommandDef<A>, args: A): HistoryState {
  return applyCommand(h, command, args);
}

export const seqIds = createSequentialIds();

export function rectFrame(id: Id, props: Partial<Extract<Frame, { type: 'rect' }>> = {}): Frame {
  return { id, type: 'rect', name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: paint('orange'), stroke: null, ...props };
}

export function textFrameArgs(id: Id, storyId: Id, text = 'Hello', props: Partial<Extract<Frame, { type: 'text' }>> = {}): AddFrameArgs {
  return {
    frame: { id, type: 'text', name: '', layerId: 'layer_1', x: 36, y: 36, w: 200, h: 100, rotation: 0, fill: null, stroke: null, storyId, inset: 0, ...props },
    pageId: 'page_1',
    story: createStory(storyId, text, { fill: paint(SWATCH_BLACK) }),
  };
}

export function imageAsset(id: Id, props: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'image',
    width: 3000,
    height: 2000,
    ppi: 300,
    colorSpace: 'rgb',
    path: `assets/${id}.jpg`,
    hash: `sha256:${'a'.repeat(64)}`,
    ...props,
  };
}

/** A small seeded PRNG (mulberry32) so a failing random sequence is reproducible from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    pickN: <T>(items: readonly T[], n: number): T[] => {
      const pool = [...items];
      const out: T[] = [];
      while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);
      return out;
    },
  };
}
export type Rng = ReturnType<typeof rng>;
