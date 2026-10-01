import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './registry';
import { formatShortcut, matchesShortcut, parseShortcut, toAccelerator, type ShortcutEvent } from './shortcuts';

const ev = (init: Partial<ShortcutEvent> & { key: string }): ShortcutEvent => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe('CommandRegistry', () => {
  it('registers, lists in order, and unregisters', () => {
    const r = new CommandRegistry();
    const offA = r.register({ id: 'a', label: 'A', run: () => {} });
    r.register({ id: 'b', label: 'B', category: 'Edit', run: () => {} });
    expect(r.list().map((c) => c.id)).toEqual(['a', 'b']);
    expect(r.byCategory('Edit').map((c) => c.id)).toEqual(['b']);
    offA();
    expect(r.has('a')).toBe(false);
    expect(r.list().map((c) => c.id)).toEqual(['b']);
  });

  it('rejects a duplicate id so two lanes cannot silently clash', () => {
    const r = new CommandRegistry();
    r.register({ id: 'x', label: 'X', run: () => {} });
    expect(() => r.register({ id: 'x', label: 'Y', run: () => {} })).toThrow(/already registered/);
  });

  it('keeps list() referentially stable until the command set changes', () => {
    const r = new CommandRegistry();
    r.register({ id: 'a', label: 'A', run: () => {} });
    const first = r.list();
    expect(r.list()).toBe(first);
    r.register({ id: 'b', label: 'B', run: () => {} });
    expect(r.list()).not.toBe(first);
  });

  it('execute runs enabled commands and skips disabled ones', async () => {
    const r = new CommandRegistry();
    const run = vi.fn();
    let on = false;
    r.register({ id: 'c', label: 'C', run, enabled: () => on });
    expect(await r.execute('c')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    on = true;
    expect(await r.execute('c')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(r.execute('nope')).rejects.toThrow(/Unknown command/);
  });

  it('notifies subscribers when the command set changes', () => {
    const r = new CommandRegistry();
    const fn = vi.fn();
    const off = r.subscribe(fn);
    const unregister = r.register({ id: 'a', label: 'A', run: () => {} });
    unregister();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    r.register({ id: 'b', label: 'B', run: () => {} });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('finds a command by shortcut', () => {
    const r = new CommandRegistry();
    r.register({ id: 'edit.undo', label: 'Undo', shortcut: 'Mod+Z', run: () => {} });
    r.register({ id: 'edit.redo', label: 'Redo', shortcut: 'Mod+Shift+Z', run: () => {} });
    r.register({ id: 'tool.select', label: 'Selection', shortcut: 'V', run: () => {} });
    expect(r.findByShortcut(ev({ key: 'z', metaKey: true }), 'mac')?.id).toBe('edit.undo');
    expect(r.findByShortcut(ev({ key: 'Z', metaKey: true, shiftKey: true }), 'mac')?.id).toBe('edit.redo');
    expect(r.findByShortcut(ev({ key: 'v' }), 'mac')?.id).toBe('tool.select');
    expect(r.findByShortcut(ev({ key: 'z', ctrlKey: true }), 'other')?.id).toBe('edit.undo');
    expect(r.findByShortcut(ev({ key: 'q' }), 'mac')).toBeUndefined();
  });
});

describe('shortcuts', () => {
  it('matches exactly: extra modifiers do not match', () => {
    expect(matchesShortcut(ev({ key: 'z', metaKey: true, shiftKey: true }), 'Mod+Z', 'mac')).toBe(false);
    expect(matchesShortcut(ev({ key: 'v', metaKey: true }), 'V', 'mac')).toBe(false);
    expect(matchesShortcut(ev({ key: 'v', ctrlKey: true }), 'Mod+V', 'mac')).toBe(false);
  });

  it('matches punctuation through the physical key code when Shift changes the character', () => {
    expect(matchesShortcut(ev({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }), 'Mod+Shift+]', 'mac')).toBe(true);
    expect(matchesShortcut(ev({ key: ']', code: 'BracketRight', metaKey: true }), 'Mod+]', 'mac')).toBe(true);
    expect(matchesShortcut(ev({ key: '\\', code: 'Backslash' }), '\\', 'mac')).toBe(true);
    expect(matchesShortcut(ev({ key: '=', code: 'Equal', metaKey: true }), 'Mod+=', 'mac')).toBe(true);
  });

  it('matches named keys and Alt+letter on macOS where Option changes event.key', () => {
    expect(matchesShortcut(ev({ key: ' ', code: 'Space' }), 'Space', 'mac')).toBe(true);
    expect(matchesShortcut(ev({ key: 'Backspace' }), 'Backspace', 'mac')).toBe(true);
    expect(matchesShortcut(ev({ key: '∂', code: 'KeyD', altKey: true }), 'Alt+D', 'mac')).toBe(true);
  });

  it('parses aliases and rejects a shortcut with no key', () => {
    expect(parseShortcut('Cmd+Shift+G')).toMatchObject({ mod: true, shift: true, key: 'g' });
    expect(parseShortcut('Mod++')).toMatchObject({ mod: true, key: '+' });
    expect(() => parseShortcut('Mod+Shift')).toThrow(/no key/);
  });

  it('formats for menus and for Electron accelerators', () => {
    expect(formatShortcut('Mod+Shift+Z', 'mac')).toBe('⇧⌘Z');
    expect(formatShortcut('Mod+Shift+Z', 'other')).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('V', 'mac')).toBe('V');
    expect(toAccelerator('Mod+Shift+Z')).toBe('CmdOrCtrl+Shift+Z');
    expect(toAccelerator('Mod+]')).toBe('CmdOrCtrl+]');
    expect(toAccelerator('Backspace')).toBe('Backspace');
  });
});
