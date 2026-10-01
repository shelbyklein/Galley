import { describe, expect, it } from 'vitest';
import {
  addAsset,
  addFrame,
  addGuide,
  addLayer,
  addPage,
  addSwatch,
  CommandError,
  groupFrames,
  makeLayer,
  makePage,
  moveFrames,
  moveFramesToLayer,
  moveFramesToPage,
  movePage,
  paint,
  parentOf,
  removeAsset,
  removeFrames,
  removeLayer,
  removePage,
  removeSwatch,
  reorderFrames,
  setFrameProps,
  setLayerProps,
  setPageProps,
  setStoryDefaults,
  setStoryDoc,
  setSwatchProps,
  storyDocFromText,
  storyPlainText,
  ungroupFrames,
  validateDocument,
  type HistoryState,
} from '../src';
import { history, imageAsset, rectFrame, run, textFrameArgs } from './helpers';

const add = (h: HistoryState, id: string, props = {}, extra: { parentId?: string; index?: number } = {}) =>
  run(h, addFrame, { frame: rectFrame(id, props), pageId: 'page_1', ...extra });
const items = (h: HistoryState, page = 'page_1') => h.doc.pages[page]!.items;
const valid = (h: HistoryState) => expect(validateDocument(h.doc)).toEqual([]);

describe('frames: add and remove', () => {
  it('adds frames on top, or at an index, and validates the frame', () => {
    let h = add(history(), 'a');
    h = add(h, 'b');
    h = add(h, 'c', {}, { index: 0 });
    expect(items(h)).toEqual(['c', 'a', 'b']);
    valid(h);
    expect(() => add(h, 'a')).toThrow(/already exists/);
    expect(() => run(h, addFrame, { frame: rectFrame('x', { w: -1 }), pageId: 'page_1' })).toThrow(CommandError);
    expect(() => run(h, addFrame, { frame: rectFrame('x', { layerId: 'ghost' }), pageId: 'page_1' })).toThrow(/No layer/);
    expect(() => run(h, addFrame, { frame: rectFrame('x', { fill: paint('ghost') }), pageId: 'page_1' })).toThrow(/No swatch/);
  });

  it('does not freeze or alias the caller\'s objects', () => {
    const frame = rectFrame('a');
    const h = run(history(), addFrame, { frame, pageId: 'page_1' });
    expect(Object.isFrozen(frame)).toBe(false);
    expect(h.doc.frames.a).not.toBe(frame);
  });

  it('a text frame brings its story, and deleting the frame deletes the story', () => {
    let h = run(history(), addFrame, textFrameArgs('t1', 'sty_1', 'Hello'));
    expect(storyPlainText(h.doc.stories.sty_1!.doc)).toBe('Hello');
    valid(h);
    expect(() => run(history(), addFrame, { ...textFrameArgs('t1', 'sty_1'), story: undefined })).toThrow(/needs its story/);
    expect(() => run(h, addFrame, textFrameArgs('t2', 'sty_1'))).toThrow(/already exists/);
    h = run(h, removeFrames, { ids: ['t1'] });
    expect(h.doc.stories).toEqual({});
    valid(h);
  });

  it('only a text frame takes a story', () => {
    expect(() => run(history(), addFrame, { frame: rectFrame('a'), pageId: 'page_1', story: textFrameArgs('t', 's').story })).toThrow(/Only a text frame/);
  });

  it('deleting a frame removes its children, and an emptied group goes too', () => {
    let h = add(add(add(history(), 'a'), 'b'), 'c');
    h = run(h, groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    h = run(h, removeFrames, { ids: ['a'] });
    expect(h.doc.frames.g).toMatchObject({ childIds: ['b'] });
    h = run(h, removeFrames, { ids: ['b'] });
    expect(h.doc.frames.g).toBeUndefined();
    expect(items(h)).toEqual(['c']);
    valid(h);
    h = run(add(history(), 'a'), groupFrames, { ids: ['a'], groupId: 'g' });
    h = run(h, removeFrames, { ids: ['g'] });
    expect(h.doc.frames).toEqual({});
  });
});

describe('frames: properties and movement', () => {
  it('sets properties on many frames, and rejects what does not apply', () => {
    let h = add(add(history(), 'a'), 'b');
    h = run(h, setFrameProps, { ids: ['a', 'b'], props: { x: 72, rotation: 15, fill: null, name: 'Box' } });
    expect(h.doc.frames.a).toMatchObject({ x: 72, rotation: 15, fill: null, name: 'Box' });
    expect(h.doc.frames.b).toMatchObject({ x: 72 });
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { inset: 3 } })).toThrow(/text frames only/);
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { assetId: null } })).toThrow(/image frames only/);
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { w: -5 } })).toThrow(/negative/);
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { x: NaN } })).toThrow(/finite/);
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { x: '36pt' as unknown as number } })).toThrow(CommandError);
    expect(() => run(h, setFrameProps, { ids: ['a'], props: { fill: paint('ghost') } })).toThrow(/No swatch/);
    valid(h);
  });

  it('placing an image sets asset and content together', () => {
    let h = run(history(), addAsset, { asset: imageAsset('ast_1') });
    h = run(h, addFrame, { frame: { id: 'i', type: 'image', name: '', layerId: 'layer_1', x: 0, y: 0, w: 300, h: 200, rotation: 0, fill: null, stroke: null, assetId: null, content: null }, pageId: 'page_1' });
    expect(() => run(h, setFrameProps, { ids: ['i'], props: { assetId: 'ast_1' } })).toThrow(/both be set/);
    h = run(h, setFrameProps, { ids: ['i'], props: { assetId: 'ast_1', content: { x: 0, y: -20, w: 300, h: 240 } } });
    expect(h.doc.frames.i).toMatchObject({ assetId: 'ast_1', content: { y: -20 } });
    h = run(h, removeAsset, { id: 'ast_1' });
    expect(h.doc.frames.i).toMatchObject({ assetId: null, content: null });
    valid(h);
  });

  it('moves a group by moving its descendants, once each', () => {
    let h = add(add(history(), 'a', { x: 0, y: 0 }), 'b', { x: 100, y: 100 });
    h = run(h, groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    h = run(h, moveFrames, { ids: ['g', 'a'], dx: 10, dy: 5 });
    expect(h.doc.frames.a).toMatchObject({ x: 10, y: 5 });
    expect(h.doc.frames.b).toMatchObject({ x: 110, y: 105 });
    expect(() => run(h, moveFrames, { ids: ['a'], dx: Infinity, dy: 0 })).toThrow(/finite/);
  });
});

describe('frames: stacking, groups, layers, pages', () => {
  it('arranges: front, back, forward, backward', () => {
    let h = ['a', 'b', 'c', 'd'].reduce((acc, id) => add(acc, id), history());
    expect(items(run(h, reorderFrames, { ids: ['b'], op: 'front' }))).toEqual(['a', 'c', 'd', 'b']);
    expect(items(run(h, reorderFrames, { ids: ['c'], op: 'back' }))).toEqual(['c', 'a', 'b', 'd']);
    expect(items(run(h, reorderFrames, { ids: ['b'], op: 'forward' }))).toEqual(['a', 'c', 'b', 'd']);
    expect(items(run(h, reorderFrames, { ids: ['c'], op: 'backward' }))).toEqual(['a', 'c', 'b', 'd']);
    expect(items(run(h, reorderFrames, { ids: ['b', 'c'], op: 'forward' }))).toEqual(['a', 'd', 'b', 'c']);
    expect(run(h, reorderFrames, { ids: ['d'], op: 'forward' })).toBe(h); // already on top: nothing to undo
    h = run(h, reorderFrames, { ids: ['a', 'c'], op: 'front' });
    expect(items(h)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('forward and backward step over frames on the same layer only', () => {
    let h = run(history(), addLayer, { layer: makeLayer({ id: 'layer_2', name: 'Top' }) });
    h = add(h, 'a');
    h = add(h, 'x', { layerId: 'layer_2' });
    h = add(h, 'b');
    expect(items(h)).toEqual(['a', 'x', 'b']);
    expect(items(run(h, reorderFrames, { ids: ['a'], op: 'forward' }))).toEqual(['x', 'b', 'a']);
  });

  it('groups members into the topmost one\'s position and layer, and ungroups in place', () => {
    let h = run(history(), addLayer, { layer: makeLayer({ id: 'layer_2', name: 'Top' }) });
    h = ['a', 'b', 'c'].reduce((acc, id) => add(acc, id), h);
    h = add(h, 'd', { layerId: 'layer_2' });
    h = run(h, groupFrames, { ids: ['a', 'd'], groupId: 'g' });
    expect(items(h)).toEqual(['b', 'c', 'g']);
    expect(h.doc.frames.g).toMatchObject({ type: 'group', childIds: ['a', 'd'], layerId: 'layer_2' });
    expect(h.doc.frames.a!.layerId).toBe('layer_2');
    expect(parentOf(h.doc, 'a')).toBe('g');
    valid(h);
    h = run(h, ungroupFrames, { ids: ['g'] });
    expect(items(h)).toEqual(['b', 'c', 'a', 'd']);
    expect(h.doc.frames.g).toBeUndefined();
    valid(h);
  });

  it('nests groups and dissolves them in either order', () => {
    const base = ['a', 'b', 'c'].reduce((acc, id) => add(acc, id), history());
    let h = run(base, groupFrames, { ids: ['a', 'b'], groupId: 'inner' });
    h = run(h, groupFrames, { ids: ['inner', 'c'], groupId: 'outer' });
    valid(h);
    expect(items(run(h, ungroupFrames, { ids: ['outer', 'inner'] }))).toEqual(['a', 'b', 'c']);
    expect(items(run(h, ungroupFrames, { ids: ['inner', 'outer'] }))).toEqual(['a', 'b', 'c']);
    expect(() => run(h, groupFrames, { ids: ['a', 'c'], groupId: 'x' })).toThrow(/same container/);
    expect(() => run(h, ungroupFrames, { ids: ['a'] })).toThrow(/not a group/);
  });

  it('moves top-level frames to another layer, but not group children', () => {
    let h = run(history(), addLayer, { layer: makeLayer({ id: 'layer_2', name: 'Two' }) });
    h = add(add(h, 'a'), 'b');
    h = run(h, groupFrames, { ids: ['a'], groupId: 'g' });
    expect(() => run(h, moveFramesToLayer, { ids: ['a'], layerId: 'layer_2' })).toThrow(/inside a group/);
    h = run(h, moveFramesToLayer, { ids: ['g', 'b'], layerId: 'layer_2' });
    expect(h.doc.frames.a!.layerId).toBe('layer_2');
    valid(h);
  });

  it('deleting a layer deletes its frames; the last layer stays; hidden and locked are plain properties', () => {
    let h = run(history(), addLayer, { layer: makeLayer({ id: 'layer_2', name: 'Two' }) });
    h = add(add(h, 'a'), 'b', { layerId: 'layer_2' });
    h = run(h, setLayerProps, { id: 'layer_2', props: { visible: false, locked: true, name: 'Hidden' } });
    expect(h.doc.layers.layer_2).toMatchObject({ visible: false, locked: true, name: 'Hidden' });
    h = run(h, removeLayer, { id: 'layer_2' });
    expect(Object.keys(h.doc.frames)).toEqual(['a']);
    expect(() => run(h, removeLayer, { id: 'layer_1' })).toThrow(/at least one layer/);
    expect(() => run(h, setLayerProps, { id: 'layer_1', props: { name: '' } })).toThrow(CommandError);
    valid(h);
  });

  it('adds, reorders and removes pages; deleting a page deletes its frames and guides; the last page stays', () => {
    let h = run(history(), addPage, { page: makePage({ id: 'page_2', width: 300, height: 400 }) });
    h = run(h, addPage, { page: makePage({ id: 'page_0' }), index: 0 });
    expect(h.doc.pageOrder).toEqual(['page_0', 'page_1', 'page_2']);
    h = run(h, movePage, { id: 'page_0', index: 2 });
    expect(h.doc.pageOrder).toEqual(['page_1', 'page_2', 'page_0']);
    h = add(h, 'a');
    h = run(h, addGuide, { guide: { id: 'gd', orientation: 'vertical', position: 100, pageId: 'page_1' } });
    h = run(h, moveFramesToPage, { ids: ['a'], pageId: 'page_2', dx: 5, dy: 5 });
    expect(items(h, 'page_2')).toEqual(['a']);
    expect(h.doc.frames.a).toMatchObject({ x: 5, y: 5 });
    h = run(h, removePage, { id: 'page_2' });
    expect(h.doc.frames).toEqual({});
    h = run(h, removePage, { id: 'page_1' });
    expect(h.doc.guides).toEqual({});
    expect(() => run(h, removePage, { id: 'page_0' })).toThrow(/at least one page/);
    valid(h);
  });

  it('rejects an invalid page or page setup', () => {
    const h = history();
    expect(() => run(h, addPage, { page: makePage({ id: 'p', width: -5 }) })).toThrow(CommandError);
    expect(() => run(h, setPageProps, { id: 'page_1', props: { margins: { top: 400, right: 0, bottom: 400, left: 0 } } })).toThrow(CommandError);
    const ok = run(h, setPageProps, { id: 'page_1', props: { width: 792, height: 1224, bleed: { top: 9, right: 9, bottom: 9, left: 9 } } });
    expect(ok.doc.pages.page_1).toMatchObject({ width: 792, height: 1224, bleed: { top: 9 } });
  });
});

describe('swatches, stories, assets', () => {
  it('adds and edits swatches; every use follows because paints refer by id', () => {
    let h = run(history(), addSwatch, { swatch: { id: 'teal', name: 'Teal', type: 'cmyk', values: [85, 10, 40, 10] } });
    expect(() => run(h, addSwatch, { swatch: { id: 'dup', name: 'Teal', type: 'cmyk', values: [0, 0, 0, 0] } })).toThrow(/already exists/);
    expect(() => run(h, addSwatch, { swatch: { id: 't', name: 'T', type: 'tint', baseId: 'ghost', percent: 50 } })).toThrow(/No swatch/);
    expect(() => run(h, addSwatch, { swatch: { id: 't', name: 'T', type: 'tint', baseId: 'spot185-40', percent: 50 } })).toThrow(/another tint/);
    h = add(h, 'a', { fill: paint('teal', 50) });
    h = run(h, setSwatchProps, { id: 'teal', props: { values: [100, 0, 0, 0], name: 'Cyanish' } });
    expect(h.doc.swatches.teal).toMatchObject({ name: 'Cyanish', values: [100, 0, 0, 0] });
    expect(() => run(h, setSwatchProps, { id: 'black', props: { name: 'Nope' } })).toThrow(/built-in/);
    expect(() => run(h, setSwatchProps, { id: 'teal', props: { values: [0, 0, 0, 101] } })).toThrow(CommandError);
    expect(() => run(h, setSwatchProps, { id: 'teal', props: { percent: 5 } })).toThrow(/tint swatches only/);
    valid(h);
  });

  it('deleting a swatch replaces its uses, removes dependent tint swatches, and protects built-ins', () => {
    let h = add(add(history(), 'a', { fill: paint('spot185', 40) }), 'b', { fill: paint('spot185-40'), stroke: { paint: paint('spot185'), weight: 2 } });
    h = run(h, addFrame, textFrameArgs('t', 's', 'x'));
    h = run(h, setStoryDefaults, { storyId: 's', props: { fill: paint('spot185') } });
    const withReplacement = run(h, removeSwatch, { id: 'spot185', replacementId: 'orange' });
    expect(withReplacement.doc.swatches.spot185).toBeUndefined();
    expect(withReplacement.doc.swatches['spot185-40']).toBeUndefined();
    expect(withReplacement.doc.frames.a).toMatchObject({ fill: { swatchId: 'orange', tint: 40 } });
    expect(withReplacement.doc.frames.b).toMatchObject({ fill: { swatchId: 'orange', tint: 100 }, stroke: { paint: { swatchId: 'orange' }, weight: 2 } });
    expect(withReplacement.doc.stories.s!.defaults.fill.swatchId).toBe('orange');
    valid(withReplacement);
    const toNone = run(h, removeSwatch, { id: 'spot185' });
    expect(toNone.doc.frames.a).toMatchObject({ fill: null });
    expect(toNone.doc.frames.b).toMatchObject({ fill: null, stroke: null });
    expect(toNone.doc.stories.s!.defaults.fill.swatchId).toBe('black');
    valid(toNone);
    expect(() => run(h, removeSwatch, { id: 'paper' })).toThrow(/Built-in/);
    expect(() => run(h, removeSwatch, { id: 'spot185', replacementId: 'spot185-40' })).toThrow(/being deleted/);
  });

  it('edits story text and default style', () => {
    let h = run(history(), addFrame, textFrameArgs('t', 's', 'Hello'));
    h = run(h, setStoryDoc, { storyId: 's', doc: storyDocFromText('Hello\nWorld') });
    expect(storyPlainText(h.doc.stories.s!.doc)).toBe('Hello\nWorld');
    expect(() => run(h, setStoryDoc, { storyId: 's', doc: { type: 'doc', content: [{ type: 'heading' }] } })).toThrow(CommandError);
    h = run(h, setStoryDefaults, { storyId: 's', props: { fontSize: 18, align: 'center' } });
    expect(h.doc.stories.s!.defaults).toMatchObject({ fontSize: 18, align: 'center', fontFamily: 'Inter' });
    expect(() => run(h, setStoryDefaults, { storyId: 's', props: { fontSize: 0 } })).toThrow(CommandError);
  });

  it('rejects a bad asset path, and a duplicate guide id', () => {
    const h = history();
    expect(() => run(h, addAsset, { asset: imageAsset('a', { path: '../outside.jpg' }) })).toThrow(CommandError);
    const g = run(h, addGuide, { guide: { id: 'gd', orientation: 'horizontal', position: 10, pageId: 'page_1' } });
    expect(() => run(g, addGuide, { guide: { id: 'gd', orientation: 'horizontal', position: 10, pageId: 'page_1' } })).toThrow(/already exists/);
    expect(() => run(h, addGuide, { guide: { id: 'x', orientation: 'horizontal', position: 10, pageId: 'ghost' } })).toThrow(/No page/);
  });
});
