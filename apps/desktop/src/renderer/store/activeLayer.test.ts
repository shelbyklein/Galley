import { addLayer, createDocument, makeLayer, removeLayer } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createEditorStore } from './editorStore';

// The active layer is where new objects go. It lives in the editor store so lane B's tools can read it, and the store
// keeps it a layer that exists.
function setup() {
  const store = createEditorStore(createDocument({ engineVersion: 'test', layer: { id: 'bottom' } }));
  store.getState().dispatch(addLayer, { layer: makeLayer({ id: 'top', name: 'Top', color: '#ff453a' }) });
  return store;
}

describe('active layer', () => {
  it('starts as the only layer, and is the top layer of an opened document', () => {
    const fresh = createEditorStore(createDocument({ engineVersion: 'test', layer: { id: 'only' } }));
    expect(fresh.getState().activeLayerId).toBe('only');
    const store = setup();
    store.getState().openDocument(store.getState().history.doc);
    expect(store.getState().history.doc.layerOrder).toEqual(['bottom', 'top']);
    expect(store.getState().activeLayerId).toBe('top');
  });

  it('can be set to a layer that exists, and ignores one that does not', () => {
    const store = setup();
    store.getState().setActiveLayer('bottom');
    expect(store.getState().activeLayerId).toBe('bottom');
    store.getState().setActiveLayer('nope');
    expect(store.getState().activeLayerId).toBe('bottom');
  });

  it('falls back to the top layer when the active one is deleted; undo does not bring the old choice back', () => {
    const store = setup();
    store.getState().setActiveLayer('top');
    store.getState().dispatch(removeLayer, { id: 'top' });
    expect(store.getState().activeLayerId).toBe('bottom');
    store.getState().undo();
    expect(store.getState().history.doc.layers.top).toBeDefined();
    expect(store.getState().activeLayerId).toBe('bottom');
  });
});
