import { describe, expect, it } from 'vitest';
import type { MenuItemSpec } from '../../../shared/ipc';
import { CommandRegistry, type Command } from '../../commands/registry';
import { acceleratorFor, buildMenuSpec, MENUS } from './menuSpec';

const noop = () => {};
const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, label, run: noop, ...extra });

function registry(...commands: Command[]): CommandRegistry {
  const r = new CommandRegistry();
  r.registerAll(commands);
  return r;
}

const find = (items: MenuItemSpec[] | undefined, id: string): MenuItemSpec | undefined => {
  for (const item of items ?? []) {
    if (item.id === id) return item;
    const inner = find(item.submenu, id);
    if (inner) return inner;
  }
  return undefined;
};
const menu = (spec: MenuItemSpec[], label: string) => spec.find((m) => m.label === label)!;

describe('the menu bar', () => {
  it('has File, Edit, Object, Type, View and Window, in that order, even with no commands registered', () => {
    const spec = buildMenuSpec({ registry: registry(), recents: [] });
    expect(spec.map((m) => m.label)).toEqual(['File', 'Edit', 'Object', 'Type', 'View', 'Window']);
    expect(MENUS.map((m) => m.label)).toEqual(['File', 'Edit', 'Object', 'Type', 'View', 'Window']);
  });

  it('shows a command that is not registered as a disabled item, never missing and never an error', () => {
    const spec = buildMenuSpec({ registry: registry(), recents: [] });
    const group = find(spec, 'object.group')!;
    expect(group).toMatchObject({ label: 'Group', enabled: false });
    expect(find(spec, 'file.exportPdf')).toMatchObject({ label: 'Export PDF/X-4…', enabled: false });
    expect(find(spec, 'object.fit.fillProportionally')).toMatchObject({ enabled: false });
  });

  it('a registered command supplies its label, shortcut and enabled state', () => {
    let enabled = false;
    const r = registry(cmd('file.save', 'Save', { shortcut: 'Mod+S' }), cmd('edit.undo', 'Undo', { shortcut: 'Mod+Z', enabled: () => enabled }));
    const build = () => buildMenuSpec({ registry: r, recents: [] });
    expect(find(build(), 'file.save')).toMatchObject({ label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: true });
    expect(find(build(), 'edit.undo')).toMatchObject({ enabled: false, accelerator: 'CmdOrCtrl+Z' });
    enabled = true;
    expect(find(build(), 'edit.undo')).toMatchObject({ enabled: true });
  });

  it('names what Undo and Redo would do', () => {
    const r = registry(cmd('edit.undo', 'Undo'), cmd('edit.redo', 'Redo'));
    const spec = buildMenuSpec({ registry: r, recents: [], undoLabel: 'Move', redoLabel: null });
    expect(find(spec, 'edit.undo')!.label).toBe('Undo Move');
    expect(find(spec, 'edit.redo')!.label).toBe('Redo');
  });

  it('check marks come from isChecked', () => {
    const r = registry(cmd('window.layers', 'Layers', { shortcut: 'F7' }));
    const spec = buildMenuSpec({ registry: r, recents: [], isChecked: (id) => (id === 'window.layers' ? true : undefined) });
    expect(find(spec, 'window.layers')).toMatchObject({ type: 'checkbox', checked: true, accelerator: 'F7' });
    expect(find(spec, 'window.pages')).toMatchObject({ type: 'normal', enabled: false });
  });

  it('commands another lane registers into a menu category appear at the end of that menu', () => {
    const r = registry(cmd('file.save', 'Save'), cmd('file.preflight', 'Preflight', { category: 'File' }), cmd('type.font', 'Font', { category: 'Type' }), cmd('tool.hand', 'Hand Tool', { category: 'Tools' }));
    const spec = buildMenuSpec({ registry: r, recents: [] });
    const file = menu(spec, 'File').submenu!;
    expect(file[file.length - 1]).toMatchObject({ id: 'file.preflight', label: 'Preflight' });
    expect(menu(spec, 'Type').submenu!.map((i) => i.label)).toEqual(['Font']);
    expect(find(spec, 'tool.hand')).toBeUndefined(); // tools have no menu
  });

  it('the Type menu says why it is empty until Phase 2 registers commands', () => {
    const spec = buildMenuSpec({ registry: registry(), recents: [] });
    const type = menu(spec, 'Type').submenu!;
    expect(type).toHaveLength(1);
    expect(type[0]).toMatchObject({ enabled: false });
  });

  it('lists recent files, newest first, each carrying its path', () => {
    const r = registry(cmd('file.clearRecent', 'Clear Menu', { enabled: () => true }));
    const spec = buildMenuSpec({ registry: r, recents: [{ name: 'Poster', path: '/a/Poster.galley' }, { name: 'Flyer', path: '/b/Flyer.galley' }] });
    const recent = find(spec, 'menu:file.openRecent')!.submenu!;
    expect(recent.filter((i) => i.id === 'file.openRecent').map((i) => [i.label, i.payload])).toEqual([
      ['Poster', '/a/Poster.galley'],
      ['Flyer', '/b/Flyer.galley'],
    ]);
    expect(recent[recent.length - 1]).toMatchObject({ id: 'file.clearRecent', label: 'Clear Menu', enabled: true });
    const empty = buildMenuSpec({ registry: r, recents: [] });
    expect(find(empty, 'menu:file.openRecent')!.submenu![0]).toMatchObject({ label: 'No Recent Documents', enabled: false });
  });

  it('never leaves a stray separator at the edge of a menu', () => {
    const spec = buildMenuSpec({ registry: registry(), recents: [] });
    const check = (items: MenuItemSpec[]) => {
      expect(items[0]!.type).not.toBe('separator');
      expect(items[items.length - 1]!.type).not.toBe('separator');
      items.forEach((item, i) => item.type === 'separator' && expect(items[i - 1]!.type).not.toBe('separator'));
      items.forEach((item) => item.submenu && check(item.submenu));
    };
    spec.forEach((m) => check(m.submenu!));
  });

  it('only offers developer tools in dev runs', () => {
    const labels = (dev: boolean) => (menu(buildMenuSpec({ registry: registry(), recents: [], dev }), 'View').submenu ?? []).map((i) => i.role).filter(Boolean);
    expect(labels(false)).not.toContain('toggleDevTools');
    expect(labels(true)).toContain('toggleDevTools');
  });
});

describe('native accelerators', () => {
  it('are set for shortcuts with Command or Control, and function keys', () => {
    expect(acceleratorFor('Mod+Shift+S')).toBe('CmdOrCtrl+Shift+S');
    expect(acceleratorFor('Mod+]')).toBe('CmdOrCtrl+]');
    expect(acceleratorFor('F12')).toBe('F12');
    expect(acceleratorFor('Mod+F7')).toBe('CmdOrCtrl+F7');
  });

  it('are left out for shortcuts that would swallow typing', () => {
    for (const s of ['V', 'T', '\\', 'Delete', 'Backspace', 'Shift+X', 'Alt+ArrowUp', undefined]) expect(acceleratorFor(s)).toBeUndefined();
  });
});
