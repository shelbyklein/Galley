import { addFrame, paint, setLayerProps, type Frame } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createEditorStore } from './editorStore';

// P1-14: "a locked layer's frames can't be selected" (and hidden layers' frames can't either), for every way of selecting.
const rect = (id: string, layerId: string): Frame => ({ id, type: 'rect', name: '', layerId, x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: paint('black'), stroke: null });

function setup() {
  const store = createEditorStore();
  const doc = store.getState().history.doc;
  const layerId = doc.layerOrder[0]!;
  const pageId = doc.pageOrder[0]!;
  store.getState().dispatch(addFrame, { frame: rect('a', layerId), pageId });
  return { store, layerId };
}

describe('selection and layers', () => {
  it('a frame on a locked layer cannot be selected, and unlocking allows it again', () => {
    const { store, layerId } = setup();
    store.getState().dispatch(setLayerProps, { id: layerId, props: { locked: true } });
    store.getState().setSelection(['a']);
    expect(store.getState().selection).toEqual([]);
    store.getState().dispatch(setLayerProps, { id: layerId, props: { locked: false } });
    store.getState().setSelection(['a']);
    expect(store.getState().selection).toEqual(['a']);
  });

  it('a frame on a hidden layer cannot be selected', () => {
    const { store, layerId } = setup();
    store.getState().dispatch(setLayerProps, { id: layerId, props: { visible: false } });
    store.getState().setSelection(['a']);
    expect(store.getState().selection).toEqual([]);
  });

  it('locking or hiding a layer drops its frames from the selection', () => {
    const { store, layerId } = setup();
    store.getState().setSelection(['a']);
    expect(store.getState().selection).toEqual(['a']);
    store.getState().dispatch(setLayerProps, { id: layerId, props: { locked: true } });
    expect(store.getState().selection).toEqual([]);
  });
});
