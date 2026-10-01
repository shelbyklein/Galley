/**
 * Shortcut strings used by the command registry, for example `Mod+Shift+Z`, `V`, `Mod+]`, `Space`, `Backspace`.
 *
 *   Mod    Command on macOS, Control elsewhere
 *   Ctrl   the Control key itself (rarely wanted)
 *   Alt    Option on macOS
 *   Shift
 *
 * The last token is the key. Letters are case-insensitive. Matching is exact: a shortcut without `Shift` does not
 * fire when Shift is held, so `Mod+Z` and `Mod+Shift+Z` never collide.
 */

export type Platform = 'mac' | 'other';

export function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { platform?: string } }).navigator;
  return nav?.platform && /mac/i.test(nav.platform) ? 'mac' : 'other';
}

export interface ParsedShortcut {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-cased key name: a letter, digit, punctuation mark, or a named key such as `space` or `arrowup`. */
  key: string;
}

export function parseShortcut(shortcut: string): ParsedShortcut {
  const tokens = splitTokens(shortcut);
  const parsed: ParsedShortcut = { mod: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (t === 'mod' || t === 'cmd' || t === 'command' || t === 'cmdorctrl') parsed.mod = true;
    else if (t === 'ctrl' || t === 'control') parsed.ctrl = true;
    else if (t === 'alt' || t === 'option' || t === 'opt') parsed.alt = true;
    else if (t === 'shift') parsed.shift = true;
    else parsed.key = t;
  }
  if (!parsed.key) throw new Error(`Shortcut "${shortcut}" has no key`);
  return parsed;
}

/** Split on `+`, but keep a literal plus key (`Mod++`) and `Shift+=`-style punctuation intact. */
function splitTokens(shortcut: string): string[] {
  if (shortcut.endsWith('++')) return [...shortcut.slice(0, -2).split('+').filter(Boolean), '+'];
  return shortcut.split('+').filter((t) => t.length > 0);
}

/** The subset of KeyboardEvent the registry reads (so tests need no DOM). */
export interface ShortcutEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Physical-key fallbacks: with Shift or Alt held, `event.key` is the shifted character, so also compare `event.code`. */
const CODE_TO_KEY: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'space',
};

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function eventKeys(e: ShortcutEvent): string[] {
  const keys = [normalizeKey(e.key)];
  if (e.code) {
    if (CODE_TO_KEY[e.code]) keys.push(CODE_TO_KEY[e.code]!);
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) keys.push(letter[1]!.toLowerCase());
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) keys.push(digit[1]!);
  }
  return keys;
}

export function matchesShortcut(e: ShortcutEvent, shortcut: string, platform: Platform = detectPlatform()): boolean {
  const s = parseShortcut(shortcut);
  const wantMeta = platform === 'mac' && s.mod;
  const wantCtrl = (platform !== 'mac' && s.mod) || s.ctrl;
  if (e.metaKey !== wantMeta) return false;
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.altKey !== s.alt) return false;
  if (e.shiftKey !== s.shift) return false;
  const key = normalizeKey(s.key);
  return eventKeys(e).includes(key);
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  backspace: '⌫',
  delete: '⌦',
  enter: '↩',
  escape: 'Esc',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** Menu display text: `⇧⌘Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(shortcut: string, platform: Platform = detectPlatform()): string {
  const s = parseShortcut(shortcut);
  const key = KEY_LABELS[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  if (platform === 'mac') {
    return `${s.ctrl ? MAC_SYMBOLS.ctrl : ''}${s.alt ? MAC_SYMBOLS.alt : ''}${s.shift ? MAC_SYMBOLS.shift : ''}${s.mod ? MAC_SYMBOLS.mod : ''}${key}`;
  }
  const parts: string[] = [];
  if (s.mod || s.ctrl) parts.push('Ctrl');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const ACCELERATOR_KEYS: Record<string, string> = {
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  '+': 'Plus',
};

/** Electron `Menu` accelerator string, for lane C's native menu bar: `CmdOrCtrl+Shift+Z`. */
export function toAccelerator(shortcut: string): string {
  const s = parseShortcut(shortcut);
  const parts: string[] = [];
  if (s.mod) parts.push('CmdOrCtrl');
  if (s.ctrl) parts.push('Ctrl');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  parts.push(ACCELERATOR_KEYS[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key));
  return parts.join('+');
}
