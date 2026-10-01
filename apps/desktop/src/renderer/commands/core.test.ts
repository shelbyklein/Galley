import { addFrame, paint } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../store/editorStore';
import { registerCoreCommands } from './core';
import { CommandRegistry } from './registry';

describe('core commands', () => {
  it('Undo and Redo run against the store and are enabled only when there is something to do', async () => {
    const store = createEditorStore();
    const registry = new CommandRegistry();
    registerCoreCommands(store, registry);
    expect(registry.isEnabled('edit.undo')).toBe(false);
    expect(registry.isEnabled('edit.redo')).toBe(false);

    const doc = store.getState().history.doc;
    store.getState().dispatch(addFrame, {
      frame: { id: 'a', type: 'rect', name: '', layerId: doc.layerOrder[0]!, x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: paint('black'), stroke: null },
      pageId: doc.pageOrder[0]!,
    });
    expect(registry.isEnabled('edit.undo')).toBe(true);
    await registry.execute('edit.undo');
    expect(store.getState().history.doc.frames.a).toBeUndefined();
    expect(registry.isEnabled('edit.redo')).toBe(true);
    await registry.execute('edit.redo');
    expect(store.getState().history.doc.frames.a).toBeDefined();
  });

  it('binds the standard shortcuts', () => {
    const registry = new CommandRegistry();
    registerCoreCommands(createEditorStore(), registry);
    const key = { key: 'z', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(registry.findByShortcut(key, 'mac')?.id).toBe('edit.undo');
    expect(registry.findByShortcut({ ...key, shiftKey: true }, 'mac')?.id).toBe('edit.redo');
  });
});
