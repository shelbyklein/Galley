import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../commands/registry';
import { createEditorStore } from '../store';
import { blank, LAYER, PAGE, rect, withFrames } from '../tools/testing';
import { canvasCommands, registerCanvasCommands } from './commands';

/** The ids and shortcuts agreed with lane C (docs: the cross-lane list). */
const AGREED: Record<string, string | undefined> = {
  'view.zoomIn': 'Mod+=',
  'view.zoomOut': 'Mod+-',
  'view.fitPage': 'Mod+0',
  'view.actualSize': 'Mod+1',
  'view.toggleRulers': 'Mod+R',
  'view.toggleGuides': 'Mod+;',
  'view.units.pt': undefined,
  'view.units.in': undefined,
  'view.units.mm': undefined,
  'edit.selectAll': 'Mod+A',
  'edit.deselectAll': 'Mod+Shift+A',
  'edit.cut': 'Mod+X',
  'edit.copy': 'Mod+C',
  'edit.paste': 'Mod+V',
  'edit.duplicate': 'Mod+Alt+Shift+D',
  'edit.delete': 'Backspace',
  'object.group': 'Mod+G',
  'object.ungroup': 'Mod+Shift+G',
  'object.bringForward': 'Mod+]',
  'object.sendBackward': 'Mod+[',
  'object.bringToFront': 'Mod+Shift+]',
  'object.sendToBack': 'Mod+Shift+[',
  'object.fit.fillProportionally': undefined,
  'object.fit.fitProportionally': undefined,
  'object.fit.contentToFrame': undefined,
  'object.fit.center': undefined,
  'file.place': 'Mod+D',
};

describe('canvas commands', () => {
  it('registers every agreed id with its shortcut, each once', () => {
    const store = createEditorStore();
    const registry = new CommandRegistry();
    registerCanvasCommands(store, registry);
    for (const [id, shortcut] of Object.entries(AGREED)) {
      const c = registry.get(id);
      expect(c, id).toBeDefined();
      if (shortcut !== undefined) expect(c!.shortcut, id).toBe(shortcut);
    }
    const ids = canvasCommands(store).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // the extras beyond the agreed list
    expect(ids.filter((id) => !(id in AGREED))).toEqual(['edit.pasteInPlace']);
  });

  it('does not collide with the core undo and redo shortcuts', () => {
    const shortcuts = canvasCommands(createEditorStore()).flatMap((c) => (c.shortcut ? [c.shortcut] : []));
    expect(shortcuts).not.toContain('Mod+Z');
    expect(shortcuts).not.toContain('Mod+Shift+Z');
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it('the units and rulers commands change the view settings', async () => {
    const store = createEditorStore();
    const registry = new CommandRegistry();
    registerCanvasCommands(store, registry);
    await registry.execute('view.units.mm');
    expect(store.getState().view.units).toBe('mm');
    await registry.execute('view.toggleRulers');
    expect(store.getState().view.rulersVisible).toBe(false);
    await registry.execute('view.toggleGuides');
    expect(store.getState().view.guidesVisible).toBe(false);
    await registry.execute('view.toggleGuides');
    expect(store.getState().view.guidesVisible).toBe(true);
  });

  it('zoom commands step the presets and fit the page', async () => {
    const store = createEditorStore();
    const registry = new CommandRegistry();
    registerCanvasCommands(store, registry);
    await registry.execute('view.actualSize');
    expect(store.getState().viewport.zoom).toBe(1);
    expect(store.getState().viewport.fit).toBe(false);
    await registry.execute('view.zoomIn');
    expect(store.getState().viewport.zoom).toBe(1.25);
    await registry.execute('view.zoomOut');
    await registry.execute('view.zoomOut');
    expect(store.getState().viewport.zoom).toBe(0.75);
    await registry.execute('view.fitPage');
    expect(store.getState().viewport.fit).toBe(true);
    expect(store.getState().viewport.zoom).toBeCloseTo((782 - 48) / 792, 6); // the default pasteboard size, before any measurement
  });

  it('object commands are enabled by the selection', async () => {
    const store = createEditorStore(withFrames([rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10)]).doc);
    const registry = new CommandRegistry();
    registerCanvasCommands(store, registry);
    for (const id of ['object.group', 'object.ungroup', 'edit.delete', 'edit.copy', 'edit.cut', 'edit.duplicate', 'object.bringToFront', 'edit.deselectAll']) expect(registry.isEnabled(id), id).toBe(false);
    expect(registry.isEnabled('edit.selectAll')).toBe(true);
    expect(registry.isEnabled('edit.paste')).toBe(false);

    await registry.execute('edit.selectAll');
    expect(store.getState().selection).toEqual(['a', 'b']);
    expect(registry.isEnabled('object.group')).toBe(true);
    expect(registry.isEnabled('object.ungroup')).toBe(false);
    await registry.execute('object.group');
    expect(registry.isEnabled('object.ungroup')).toBe(true);
    expect(registry.isEnabled('object.group')).toBe(false); // one object
    await registry.execute('edit.copy');
    expect(registry.isEnabled('edit.paste')).toBe(true);
    await registry.execute('edit.delete');
    expect(Object.keys(store.getState().history.doc.frames)).toEqual([]);
    expect(store.getState().history.doc.pages[PAGE]!.items).toEqual([]);
    expect(LAYER).toBeTruthy();
    void blank;
  });

  it('object commands stand down while a gesture has a transaction open', () => {
    const store = createEditorStore(withFrames([rect('a', 0, 0, 10, 10)]).doc);
    const registry = new CommandRegistry();
    registerCanvasCommands(store, registry);
    store.getState().setSelection(['a']);
    expect(registry.isEnabled('edit.delete')).toBe(true);
    store.getState().beginTransaction('Move');
    expect(registry.isEnabled('edit.delete')).toBe(false);
    expect(registry.isEnabled('object.bringToFront')).toBe(false);
    expect(registry.isEnabled('file.place')).toBe(false);
  });
});
