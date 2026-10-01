/**
 * The menu bar, described from the command registry. Pure: give it a registry and a little state, get the native menu
 * description back (src/shared/ipc.ts `MenuItemSpec`); the bridge (./menuBridge.ts) sends it to the main process.
 *
 * Menus reference command ids. Other lanes register many of them, so an id that is not registered is shown *disabled*
 * with a fallback label (never a crash, never a missing menu). A registered command takes its label, shortcut and
 * enabled state from the registry. Registered commands whose `category` is a menu but that this table does not list
 * are appended to the end of that menu, so a later lane's commands appear without touching this file.
 */
import type { MenuItemSpec, RecentFile } from '../../../shared/ipc';
import type { Command, CommandCategory, CommandRegistry } from '../../commands/registry';
import { parseShortcut, toAccelerator } from '../../commands/shortcuts';

type Entry =
  | '-'
  | readonly [id: string, fallbackLabel: string]
  | { submenu: string; label: string; items: readonly Entry[] }
  | { recents: true }
  | { role: string; label?: string; dev?: boolean };

interface MenuDef {
  id: string;
  label: string;
  category: CommandCategory;
  items: readonly Entry[];
}

/** The menu bar. This table is the spec the report lists. */
export const MENUS: readonly MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    category: 'File',
    items: [
      ['file.new', 'New…'],
      ['file.open', 'Open…'],
      { recents: true },
      '-',
      ['file.close', 'Close'],
      ['file.save', 'Save'],
      ['file.saveAs', 'Save As…'],
      '-',
      ['file.place', 'Place…'],
      '-',
      ['file.exportPdf', 'Export PDF/X-4…'],
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    category: 'Edit',
    items: [
      ['edit.undo', 'Undo'],
      ['edit.redo', 'Redo'],
      '-',
      ['edit.cut', 'Cut'],
      ['edit.copy', 'Copy'],
      ['edit.paste', 'Paste'],
      ['edit.duplicate', 'Duplicate'],
      ['edit.delete', 'Delete'],
      '-',
      ['edit.selectAll', 'Select All'],
      ['edit.deselectAll', 'Deselect All'],
    ],
  },
  {
    id: 'object',
    label: 'Object',
    category: 'Object',
    items: [
      ['object.group', 'Group'],
      ['object.ungroup', 'Ungroup'],
      '-',
      {
        submenu: 'object.arrange',
        label: 'Arrange',
        items: [
          ['object.bringToFront', 'Bring to Front'],
          ['object.bringForward', 'Bring Forward'],
          ['object.sendBackward', 'Send Backward'],
          ['object.sendToBack', 'Send to Back'],
        ],
      },
      {
        submenu: 'object.fitting',
        label: 'Fitting',
        items: [
          ['object.fit.fillProportionally', 'Fill Frame Proportionally'],
          ['object.fit.fitProportionally', 'Fit Content Proportionally'],
          ['object.fit.contentToFrame', 'Fit Content to Frame'],
          ['object.fit.center', 'Center Content'],
        ],
      },
    ],
  },
  { id: 'type', label: 'Type', category: 'Type', items: [] },
  {
    id: 'view',
    label: 'View',
    category: 'View',
    items: [
      ['view.zoomIn', 'Zoom In'],
      ['view.zoomOut', 'Zoom Out'],
      ['view.fitPage', 'Fit Page in Window'],
      ['view.actualSize', 'Actual Size'],
      '-',
      ['view.toggleRulers', 'Rulers'],
      ['view.toggleGuides', 'Guides'],
      {
        submenu: 'view.units',
        label: 'Units',
        items: [
          ['view.units.pt', 'Points'],
          ['view.units.in', 'Inches'],
          ['view.units.mm', 'Millimeters'],
        ],
      },
      '-',
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools', label: 'Toggle Developer Tools', dev: true },
    ],
  },
  {
    id: 'window',
    label: 'Window',
    category: 'Window',
    items: [['window.pages', 'Pages'], ['window.layers', 'Layers'], ['window.swatches', 'Swatches'], '-', { role: 'minimize' }, { role: 'zoom' }],
  },
];

/** Shown in the Type menu until some lane registers Type commands (Phase 2). */
const TYPE_PLACEHOLDER = 'Character and paragraph controls arrive in Phase 2';

export interface MenuContext {
  registry: Pick<CommandRegistry, 'get' | 'isEnabled' | 'list'>;
  recents: readonly RecentFile[];
  /** Check-mark state for a command id, or undefined for a plain item. */
  isChecked?(id: string): boolean | undefined;
  /** The undo and redo labels (`Move`), appended to Undo and Redo. */
  undoLabel?: string | null;
  redoLabel?: string | null;
  /** Developer menu items (Toggle Developer Tools) are included only in dev runs. */
  dev?: boolean;
}

/**
 * Electron accelerator for a registry shortcut, or undefined when the shortcut must stay with the window: a native
 * accelerator without a modifier would swallow the key while typing in a text field (`V`, `Delete`), so only shortcuts
 * with Command/Control, or function keys, become native accelerators. The window's key handler runs the others.
 */
export function acceleratorFor(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  const parsed = parseShortcut(shortcut);
  const isFunctionKey = /^f\d{1,2}$/.test(parsed.key);
  if (!parsed.mod && !parsed.ctrl && !isFunctionKey) return undefined;
  const accelerator = toAccelerator(shortcut);
  return isFunctionKey ? accelerator.replace(/f(\d{1,2})$/, 'F$1') : accelerator;
}

function commandItem(command: Command, fallback: string, ctx: MenuContext): MenuItemSpec {
  let label = command.label || fallback;
  if (command.id === 'edit.undo' && ctx.undoLabel) label = `${label} ${ctx.undoLabel}`;
  if (command.id === 'edit.redo' && ctx.redoLabel) label = `${label} ${ctx.redoLabel}`;
  const checked = ctx.isChecked?.(command.id) ?? (command as { checked?: () => boolean }).checked?.();
  return {
    id: command.id,
    label,
    type: checked === undefined ? 'normal' : 'checkbox',
    ...(checked === undefined ? {} : { checked }),
    accelerator: acceleratorFor(command.shortcut),
    enabled: ctx.registry.isEnabled(command.id),
  };
}

function buildEntries(entries: readonly Entry[], ctx: MenuContext, used: Set<string>): MenuItemSpec[] {
  const out: MenuItemSpec[] = [];
  for (const entry of entries) {
    if (entry === '-') {
      out.push({ type: 'separator' });
    } else if (Array.isArray(entry)) {
      const [id, fallback] = entry as readonly [string, string];
      used.add(id);
      const command = ctx.registry.get(id);
      out.push(command ? commandItem(command, fallback, ctx) : { id, label: fallback, type: 'normal', enabled: false });
    } else if ('submenu' in entry) {
      out.push({ id: `menu:${entry.submenu}`, label: entry.label, submenu: buildEntries(entry.items, ctx, used) });
    } else if ('recents' in entry) {
      out.push(recentsMenu(ctx));
    } else if ('role' in entry) {
      if (entry.dev && !ctx.dev) continue;
      out.push({ role: entry.role, label: entry.label });
    }
  }
  return dropEdgeSeparators(out);
}

function recentsMenu(ctx: MenuContext): MenuItemSpec {
  const items: MenuItemSpec[] =
    ctx.recents.length === 0
      ? [{ id: 'file.openRecent.none', label: 'No Recent Documents', enabled: false }]
      : ctx.recents.map((r) => ({ id: 'file.openRecent', label: r.name, payload: r.path, enabled: true }));
  const clear = ctx.registry.get('file.clearRecent');
  items.push({ type: 'separator' }, clear ? commandItem(clear, 'Clear Menu', ctx) : { id: 'file.clearRecent', label: 'Clear Menu', enabled: false });
  return { id: 'menu:file.openRecent', label: 'Open Recent', submenu: items };
}

/** No separator first, last or doubled (a menu whose neighbors are all absent would otherwise show stray lines). */
function dropEdgeSeparators(items: MenuItemSpec[]): MenuItemSpec[] {
  const out: MenuItemSpec[] = [];
  for (const item of items) {
    if (item.type === 'separator' && (out.length === 0 || out[out.length - 1]!.type === 'separator')) continue;
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1]!.type === 'separator') out.pop();
  return out;
}

/** The whole menu bar (without the macOS application menu, which the main process adds). */
export function buildMenuSpec(ctx: MenuContext): MenuItemSpec[] {
  const used = new Set<string>();
  const menus: MenuItemSpec[] = [];
  const claimed = MENUS.flatMap((m) => collectIds(m.items));
  for (const def of MENUS) {
    let items = buildEntries(def.items, ctx, used);
    // commands another lane registered into this menu's category, in registration order
    const extras = ctx.registry.list().filter((c) => c.category === def.category && !claimed.includes(c.id));
    if (extras.length > 0) {
      items = [...items, ...(items.length > 0 ? [{ type: 'separator' } as MenuItemSpec] : []), ...extras.map((c) => commandItem(c, c.label, ctx))];
    }
    if (items.length === 0) items = [{ id: `menu:${def.id}.placeholder`, label: def.id === 'type' ? TYPE_PLACEHOLDER : 'No commands', enabled: false }];
    menus.push({ id: `menu:${def.id}`, label: def.label, submenu: items });
  }
  return menus;
}

function collectIds(entries: readonly Entry[]): string[] {
  const ids: string[] = [];
  for (const e of entries) {
    if (e === '-') continue;
    if (Array.isArray(e)) ids.push((e as readonly [string, string])[0]);
    else if (typeof e === 'object' && 'submenu' in e) ids.push(...collectIds(e.items));
  }
  return ids;
}
