// The native application menu. The renderer owns the command registry, so it describes the menu (ids, labels,
// accelerators, enabled and checked state) and sends it here; this module turns the description into an Electron
// `Menu` and sends clicks back as command ids. Owned by lane C.
//
// Why native menus built from a description (and not an in-window HTML menu bar): the mockup has no in-window menu bar,
// macOS users expect the menu at the top of the screen, and a native menu is what lets Playwright (and the accessibility
// tree) see the real menu. The registry stays the single source of truth.
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommandMessage, MenuItemSpec } from '../shared/ipc';

const IS_MAC = process.platform === 'darwin';

/** Menu commands that still work when no window is open (macOS keeps the app running after the last window closes). */
export const NO_WINDOW_COMMANDS: ReadonlySet<string> = new Set(['file.new', 'file.open', 'file.openRecent']);

let lastSpec: MenuItemSpec[] = [];
let noWindow = false;
let dispatch: (message: MenuCommandMessage, window: BrowserWindow | undefined) => void = () => {};
const asBrowserWindow = (w: Electron.BaseWindow | undefined): BrowserWindow | undefined => (w instanceof BrowserWindow ? w : undefined);

export function setMenuDispatcher(fn: typeof dispatch): void {
  dispatch = fn;
}

function toTemplate(items: readonly MenuItemSpec[]): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' };
    if (item.role) return { role: item.role as MenuItemConstructorOptions['role'], label: item.label };
    const enabled = noWindow ? item.enabled !== false && (item.submenu !== undefined || (item.id !== undefined && NO_WINDOW_COMMANDS.has(item.id))) : item.enabled !== false;
    if (item.submenu) {
      return { id: item.id, label: item.label, submenu: toTemplate(item.submenu), enabled };
    }
    return {
      id: item.id,
      label: item.label,
      type: item.type === 'checkbox' ? 'checkbox' : 'normal',
      checked: item.checked,
      accelerator: item.accelerator,
      enabled,
      click: (_menuItem, window) => {
        if (item.id) dispatch({ id: item.id, payload: item.payload }, asBrowserWindow(window));
      },
    };
  });
}

/** The macOS application menu (About, Hide, Quit). Other platforms have none. */
function appMenu(): MenuItemConstructorOptions[] {
  if (!IS_MAC) return [];
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ];
}

function build(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([...appMenu(), ...toTemplate(lastSpec)]));
}

/** Replace the application menu with the renderer's description. */
export function applyMenuSpec(spec: MenuItemSpec[]): void {
  lastSpec = spec;
  build();
}

/** With no window open only New, Open and Open Recent stay enabled. */
export function setNoWindowMode(value: boolean): void {
  if (noWindow === value) return;
  noWindow = value;
  build();
}

/** A minimal menu until the renderer sends its own (and for the moment between windows). */
export function installStartupMenu(): void {
  build();
}
