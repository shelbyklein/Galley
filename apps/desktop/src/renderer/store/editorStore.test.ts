import { addFrame, CommandError, moveFrames, paint, removeFrames, serializeDocument, setMeta, type Frame } from '@galley/model';
import { describe, expect, it, vi } from 'vitest';
import { createEditorStore, selectCanRedo, selectCanUndo, selectDoc, selectIsDirty, selectUndoLabel } from './editorStore';

const rect = (id: string, x = 0): Frame => ({ id, type: 'rect', name: '', layerId: '', x, y: 0, w: 50, h: 50, rotation: 0, fill: paint('black'), stroke: null });

function setup() {
  const store = createEditorStore();
  const doc = store.getState().history.doc;
  const pageId = doc.pageOrder[0]!;
  const layerId = doc.layerOrder[0]!;
  const add = (id: string, x = 0) => store.getState().dispatch(addFrame, { frame: { ...rect(id, x), layerId }, pageId });
  return { store, pageId, layerId, add };
}

describe('editor store: document and history', () => {
  it('starts with a blank Letter document and nothing to undo', () => {
    const { store } = setup();
    const doc = selectDoc(store.getState());
    expect(doc.meta.title).toBe('Untitled');
    expect([doc.pages[doc.pageOrder[0]!]!.width, doc.pages[doc.pageOrder[0]!]!.height]).toEqual([612, 792]);
    expect(selectCanUndo(store.getState())).toBe(false);
  });

  it('dispatch, undo and redo update the document and the flags', () => {
    const { store, add } = setup();
    add('a');
    expect(selectDoc(store.getState()).frames.a).toBeDefined();
    expect(selectUndoLabel(store.getState())).toBe('Add Frame');
    store.getState().undo();
    expect(selectDoc(store.getState()).frames.a).toBeUndefined();
    expect(selectCanRedo(store.getState())).toBe(true);
    store.getState().redo();
    expect(selectDoc(store.getState()).frames.a).toBeDefined();
  });

  it('a transaction is one undo step, and cancel restores the document', () => {
    const { store, add } = setup();
    add('a');
    const s = () => store.getState();
    s().beginTransaction('Move');
    for (let i = 0; i < 50; i++) s().dispatch(moveFrames, { ids: ['a'], dx: 2, dy: 0 });
    expect(selectDoc(s()).frames.a).toMatchObject({ x: 100 });
    s().commitTransaction();
    expect(s().history.past.length).toBe(2);
    s().undo();
    expect(selectDoc(s()).frames.a).toMatchObject({ x: 0 });

    s().beginTransaction('Move');
    s().dispatch(moveFrames, { ids: ['a'], dx: 30, dy: 0 });
    s().cancelTransaction();
    expect(selectDoc(s()).frames.a).toMatchObject({ x: 0 });
    expect(s().history.past.length).toBe(2 - 1); // the move was undone above, only the add remains
  });

  it('a rejected command throws and changes nothing', () => {
    const { store } = setup();
    const before = store.getState().history;
    expect(() => store.getState().dispatch(removeFrames, { ids: ['ghost'] })).toThrow(CommandError);
    expect(store.getState().history).toBe(before);
  });

  it('tracks dirtiness against the saved revision, including undo back to clean', () => {
    const { store, add } = setup();
    expect(selectIsDirty(store.getState())).toBe(false);
    add('a');
    expect(selectIsDirty(store.getState())).toBe(true);
    store.getState().markSaved();
    expect(selectIsDirty(store.getState())).toBe(false);
    store.getState().undo();
    expect(selectIsDirty(store.getState())).toBe(true);
    store.getState().redo();
    expect(selectIsDirty(store.getState())).toBe(false);
  });

  it('openDocument replaces the document and resets history, selection and viewport', () => {
    const { store, add } = setup();
    add('a');
    store.getState().setSelection(['a']);
    store.getState().setViewport({ zoom: 2, fit: false });
    const other = createEditorStore().getState().history.doc;
    store.getState().openDocument({ ...other, meta: { ...other.meta, title: 'Other' } });
    const s = store.getState();
    expect(selectDoc(s).meta.title).toBe('Other');
    expect(s.history.past.length).toBe(0);
    expect(s.selection).toEqual([]);
    expect(s.viewport).toEqual({ zoom: 1, panX: 0, panY: 0, fit: true });
    expect(selectIsDirty(s)).toBe(false);
  });
});

describe('editor store: state outside undo history', () => {
  it('selection, viewport and tool changes never create undo steps or change the document', () => {
    const { store, add } = setup();
    add('a');
    add('b', 100);
    const s = () => store.getState();
    const docBefore = selectDoc(s());
    const stepsBefore = s().history.past.length;
    s().setSelection(['a']);
    s().toggleSelection('b');
    s().toggleSelection('a');
    s().setViewport({ zoom: 0.5, panX: 10, panY: 20, fit: false });
    s().setActiveTool('rectangle');
    expect(s().selection).toEqual(['b']);
    expect(s().viewport).toMatchObject({ zoom: 0.5, panX: 10 });
    expect(s().activeTool).toBe('rectangle');
    expect(selectDoc(s())).toBe(docBefore);
    expect(s().history.past.length).toBe(stepsBefore);
    expect(selectCanUndo(s())).toBe(true);
    expect(selectIsDirty(s())).toBe(true); // from the two adds, not from the UI state
    s().markSaved();
    s().setSelection(['a', 'b']);
    s().setViewport({ zoom: 2 });
    s().setActiveTool('hand');
    expect(selectIsDirty(s())).toBe(false);
  });

  it('undo does not touch selection, viewport or tool, except to drop ids that disappeared', () => {
    const { store, add } = setup();
    add('a');
    add('b', 100);
    const s = () => store.getState();
    s().setSelection(['a', 'b']);
    s().setViewport({ zoom: 3, fit: false });
    s().setActiveTool('ellipse');
    s().undo(); // removes b
    expect(s().selection).toEqual(['a']);
    expect(s().viewport.zoom).toBe(3);
    expect(s().activeTool).toBe('ellipse');
    s().redo();
    expect(s().selection).toEqual(['a']); // not restored: selection is not history
  });

  it('ignores selecting ids that do not exist, and de-duplicates', () => {
    const { store, add } = setup();
    add('a');
    store.getState().setSelection(['a', 'ghost', 'a']);
    expect(store.getState().selection).toEqual(['a']);
  });

  it('notifies subscribers only when something changed', () => {
    const { store, add } = setup();
    add('a');
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setSelection(['a']);
    store.getState().setSelection(['a']); // same selection: no notification
    store.getState().clearSelection();
    store.getState().clearSelection();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the current page valid when pages go away', async () => {
    const { store } = setup();
    const { addPage, makePage, removePage } = await import('@galley/model');
    store.getState().dispatch(addPage, { page: makePage({ id: 'page_b' }) });
    store.getState().setCurrentPage('page_b');
    expect(store.getState().currentPageId).toBe('page_b');
    store.getState().dispatch(removePage, { id: 'page_b' });
    expect(store.getState().currentPageId).toBe(store.getState().history.doc.pageOrder[0]);
  });

  it('serializes the same bytes after an undo (history never leaks into the file)', () => {
    const { store, add } = setup();
    const before = serializeDocument(selectDoc(store.getState())).document;
    add('a');
    store.getState().dispatch(setMeta, { title: 'Changed' });
    store.getState().undo();
    store.getState().undo();
    expect(serializeDocument(selectDoc(store.getState())).document).toBe(before);
  });
});
