import { serializeDocument, validateDocument, addLayer, makeLayer, setLayerProps } from '@galley/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../store';
import {
  arrangeSelection,
  clearClipboard,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  pasteClipboard,
  PASTE_OFFSET,
  selectAll,
  targetLayerId,
  ungroupSelection,
} from './actions';
import { LAYER, PAGE, rect, withFrames } from './testing';

const text = (id: string, x: number) => ({ id, type: 'text' as const, name: '', layerId: LAYER, x, y: 10, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId: `s_${id}`, inset: 0 });

function setup() {
  const store = createEditorStore(withFrames([rect('a', 0, 0, 40, 40), rect('b', 100, 100, 40, 40), text('t', 200), rect('c', 300, 300, 10, 10)]).doc);
  const json = () => serializeDocument(store.getState().history.doc).document;
  const items = () => store.getState().history.doc.pages[PAGE]!.items;
  return { store, json, items, s: () => store.getState() };
}

beforeEach(() => clearClipboard());

describe('delete, group, arrange', () => {
  it('deletes the selection in one step and undo restores the document byte for byte', () => {
    const { store, json, items, s } = setup();
    const before = json();
    s().setSelection(['a', 't']);
    expect(deleteSelection(store)).toBe(true);
    expect(items()).toEqual(['b', 'c']);
    expect(s().selection).toEqual([]);
    expect(s().history.doc.stories).toEqual({});
    s().undo();
    expect(json()).toBe(before);
    expect(deleteSelection(store)).toBe(false); // nothing selected
  });

  it('groups and ungroups, selecting the result', () => {
    const { store, json, items, s } = setup();
    const before = json();
    s().setSelection(['a', 'b']);
    const g = groupSelection(store)!;
    expect(g).toBeTruthy();
    expect(items()).toEqual([g, 't', 'c']);
    expect(s().selection).toEqual([g]);
    expect(s().history.past).toHaveLength(1);
    const grouped = json();
    expect(ungroupSelection(store)).toBe(true);
    expect(items()).toEqual(['a', 'b', 't', 'c']);
    expect(s().selection).toEqual(['a', 'b']);
    s().undo();
    expect(json()).toBe(grouped);
    s().undo();
    expect(json()).toBe(before);
    expect(validateDocument(s().history.doc)).toEqual([]);
  });

  it('will not group fewer than two frames', () => {
    const { store, s } = setup();
    s().setSelection(['a']);
    expect(groupSelection(store)).toBeNull();
  });

  it('arranges: forward, backward, front and back', () => {
    const { store, items, s } = setup();
    s().setSelection(['a']);
    arrangeSelection(store, 'forward');
    expect(items()).toEqual(['b', 'a', 't', 'c']);
    arrangeSelection(store, 'front');
    expect(items()).toEqual(['b', 't', 'c', 'a']);
    arrangeSelection(store, 'backward');
    expect(items()).toEqual(['b', 't', 'a', 'c']);
    arrangeSelection(store, 'back');
    expect(items()).toEqual(['a', 'b', 't', 'c']);
  });
});

describe('copy, cut, paste, duplicate', () => {
  it('pastes copies offset from the originals, with new ids, selected, in one undo step', () => {
    const { store, json, items, s } = setup();
    const before = json();
    s().setSelection(['b']);
    expect(copySelection(store)).toBe(true);
    const [copy] = pasteClipboard(store);
    expect(copy).toBeDefined();
    expect(copy).not.toBe('b');
    expect(s().selection).toEqual([copy]);
    expect(items()).toEqual(['a', 'b', 't', 'c', copy]);
    expect(s().history.doc.frames[copy!]).toMatchObject({ x: 100 + PASTE_OFFSET, y: 100 + PASTE_OFFSET, w: 40 });
    expect(s().history.past).toHaveLength(1);
    // a second paste steps again
    const [second] = pasteClipboard(store);
    expect(s().history.doc.frames[second!]).toMatchObject({ x: 100 + 2 * PASTE_OFFSET });
    s().undo();
    s().undo();
    expect(json()).toBe(before);
  });

  it('pastes in place exactly', () => {
    const { store, s } = setup();
    s().setSelection(['b']);
    copySelection(store);
    const [copy] = pasteClipboard(store, { inPlace: true });
    expect(s().history.doc.frames[copy!]).toMatchObject({ x: 100, y: 100 });
  });

  it('copies a text frame with its own story', () => {
    const { store, s } = setup();
    s().setSelection(['t']);
    copySelection(store);
    const [copy] = pasteClipboard(store);
    const f = s().history.doc.frames[copy!]!;
    expect(f.type).toBe('text');
    if (f.type !== 'text') return;
    expect(f.storyId).not.toBe('s_t');
    expect(s().history.doc.stories[f.storyId]!.doc).toEqual(s().history.doc.stories['s_t']!.doc);
    expect(Object.keys(s().history.doc.stories)).toHaveLength(2);
    expect(validateDocument(s().history.doc)).toEqual([]);
  });

  it('copies a group as a group with fresh children', () => {
    const { store, s } = setup();
    s().setSelection(['a', 'b']);
    const g = groupSelection(store)!;
    copySelection(store);
    const [copy] = pasteClipboard(store);
    const doc = s().history.doc;
    expect(doc.frames[copy!]!.type).toBe('group');
    const children = (doc.frames[copy!] as { childIds: string[] }).childIds;
    expect(children).toHaveLength(2);
    expect(children).not.toContain('a');
    expect(doc.frames[children[0]!]).toMatchObject({ x: PASTE_OFFSET, y: PASTE_OFFSET, w: 40 });
    expect(doc.frames[g]).toBeDefined();
    expect(validateDocument(doc)).toEqual([]);
  });

  it('cut removes the originals and paste brings them back as new frames', () => {
    const { store, items, s } = setup();
    s().setSelection(['b', 'c']);
    expect(cutSelection(store)).toBe(true);
    expect(items()).toEqual(['a', 't']);
    const ids = pasteClipboard(store);
    expect(ids).toHaveLength(2);
    expect(items()).toHaveLength(4);
  });

  it('puts pasted frames on a visible, unlocked layer when the original layer is gone or locked', () => {
    const { store, s } = setup();
    s().setSelection(['a']);
    copySelection(store);
    s().dispatch(addLayer, { layer: makeLayer({ id: 'top', name: 'Top' }) });
    s().dispatch(setLayerProps, { id: 'top', props: { locked: true } });
    expect(targetLayerId(s().history.doc, [])).toBe(LAYER);
    const [copy] = pasteClipboard(store);
    expect(s().history.doc.frames[copy!]!.layerId).toBe(LAYER);
  });

  it('duplicates in one step, offset, and selects the copies', () => {
    const { store, json, items, s } = setup();
    const before = json();
    s().setSelection(['a', 'b']);
    const copies = duplicateSelection(store);
    expect(copies).toHaveLength(2);
    expect(items().slice(-2)).toEqual(copies);
    expect(s().selection).toEqual(copies);
    s().undo();
    expect(json()).toBe(before);
  });

  it('does nothing with an empty clipboard or selection', () => {
    const { store, s } = setup();
    expect(pasteClipboard(store)).toEqual([]);
    expect(copySelection(store)).toBe(false);
    expect(duplicateSelection(store)).toEqual([]);
    expect(s().history.past).toHaveLength(0);
  });
});

describe('select all', () => {
  it('selects every selectable top-level frame on the page', () => {
    const { store, s } = setup();
    selectAll(store);
    expect(s().selection).toEqual(['a', 'b', 't', 'c']);
    s().dispatch(setLayerProps, { id: LAYER, props: { locked: true } });
    selectAll(store);
    expect(s().selection).toEqual([]);
  });
});
