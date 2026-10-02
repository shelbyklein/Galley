import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Helpers for the shell, files and panels specs (lane C). They drive what a test cannot click: the native menu bar and
 * the native Open / Save As / unsaved-changes panels, which are stubbed in the main process.
 */

// ---------------------------------------------------------------------------------------------------------- menu

export interface MenuNode {
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  checked: boolean;
  accelerator: string;
  role: string;
  payload?: string;
  items?: MenuNode[];
}

/** The native application menu as plain data (menu bar entries, with their items nested). */
export async function readMenu(app: ElectronApplication): Promise<MenuNode[]> {
  return app.evaluate(({ Menu }) => {
    const convert = (item: Electron.MenuItem): unknown => ({
      id: item.id ?? '',
      label: item.label,
      type: item.type,
      enabled: item.enabled,
      checked: item.checked,
      accelerator: item.accelerator ? String(item.accelerator) : '',
      role: item.role ?? '',
      items: item.submenu ? item.submenu.items.map(convert) : undefined,
    });
    return (Menu.getApplicationMenu()?.items ?? []).map(convert) as never;
  });
}

/** The menu bar entries of Galley's own menus (without the macOS application menu). */
export async function readGalleyMenus(app: ElectronApplication): Promise<MenuNode[]> {
  const all = await readMenu(app);
  return all.filter((m) => m.id.startsWith('menu:'));
}

export function findItem(nodes: MenuNode[] | undefined, match: (n: MenuNode) => boolean): MenuNode | undefined {
  for (const n of nodes ?? []) {
    if (match(n)) return n;
    const inner = findItem(n.items, match);
    if (inner) return inner;
  }
  return undefined;
}

/** Click a native menu item: by command id, or by id and label (recent files share an id). */
export async function clickMenuItem(app: ElectronApplication, id: string, label?: string): Promise<void> {
  const ok = await app.evaluate(
    ({ Menu }, { id, label }) => {
      const walk = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.id === id && (label === undefined || item.label === label)) return item;
          const inner = item.submenu ? walk(item.submenu.items) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      const item = walk(Menu.getApplicationMenu()?.items ?? []);
      if (!item || !item.enabled) return false;
      item.click();
      return true;
    },
    { id, label },
  );
  if (!ok) throw new Error(`Menu item ${id}${label ? ` "${label}"` : ''} is missing or disabled`);
}

// -------------------------------------------------------------------------------------------------------- dialogs

export type ConfirmAnswer = 'save' | 'discard' | 'cancel';

export interface DialogScript {
  /** Paths the Open panel returns, one per call. Cancelled when the list runs out. */
  open?: string[];
  /** Paths the Save As panel returns, one per call. Cancelled when the list runs out. */
  save?: string[];
  /** Answers to the unsaved-changes prompt, one per call. Cancel when the list runs out. */
  confirm?: ConfirmAnswer[];
}

/**
 * Replace the native panels in the main process with scripted answers (a native panel cannot be clicked by a test and
 * would hang it). `dialogCalls` reports what the app asked.
 */
export async function stubDialogs(app: ElectronApplication, script: DialogScript): Promise<void> {
  await app.evaluate(({ dialog }, script) => {
    const g = globalThis as unknown as { __dialogCalls: { kind: string; message?: string; defaultPath?: string }[] };
    g.__dialogCalls = [];
    const open = [...(script.open ?? [])];
    const save = [...(script.save ?? [])];
    const confirm = [...(script.confirm ?? [])];
    const answers = { save: 0, discard: 1, cancel: 2 } as const;
    const lastOptions = <T>(args: unknown[]): T => args[args.length - 1] as T;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      g.__dialogCalls.push({ kind: 'open', ...lastOptions<{ defaultPath?: string }>(args) });
      const p = open.shift();
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    }) as never;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      g.__dialogCalls.push({ kind: 'save', ...lastOptions<{ defaultPath?: string }>(args) });
      const p = save.shift();
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    }) as never;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      g.__dialogCalls.push({ kind: 'confirm', message: lastOptions<{ message?: string }>(args).message });
      return { response: answers[confirm.shift() ?? 'cancel'], checkboxChecked: false };
    }) as never;
  }, script);
}

export async function dialogCalls(app: ElectronApplication): Promise<{ kind: string; message?: string; defaultPath?: string }[]> {
  return app.evaluate(() => (globalThis as unknown as { __dialogCalls?: never[] }).__dialogCalls ?? []);
}

// --------------------------------------------------------------------------------------------------- editor state

interface Hook {
  store: { getState(): any };
  commands: { execute(id: string): Promise<boolean> };
  model: any;
}

/** Select frames through the store (selection gestures are lane B's; shell tests set the selection directly). */
export async function setSelection(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((ids) => (window as unknown as { __galley: Hook }).__galley.store.getState().setSelection(ids), ids);
}

/** Dispatch a model command by its export name in `@galley/model`, as a panel would. */
export async function dispatchModel(page: Page, command: string, args: unknown): Promise<void> {
  await page.evaluate(
    ({ command, args }) => {
      const g = (window as unknown as { __galley: Hook }).__galley;
      g.store.getState().dispatch(g.model[command], args);
    },
    { command, args },
  );
}

/** One frame of the current document (canonical), or undefined. */
export async function getFrame(page: Page, id: string): Promise<any> {
  return page.evaluate((id) => (window as unknown as { __galley: Hook }).__galley.store.getState().history.doc.frames[id], id);
}

/** The current document as the model has it (not canonical JSON): for deep-equality checks. */
export async function getModelDoc(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __galley: Hook }).__galley.store.getState().history.doc)));
}

/** The shell store (panels, proxy target, file state, notices), as plain data. */
export async function getShellState(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __galleyShell: { store: { getState(): any } } }).__galleyShell.store.getState();
    return {
      panels: s.panels as Record<string, { visible: boolean; collapsed: boolean }>,
      proxyTarget: s.proxyTarget as string,
      refPoint: s.refPoint as { x: number; y: number },
      activeLayerId: s.activeLayerId as string | null,
      packagePath: s.packagePath as string | null,
      missingLinks: s.missingLinks as { assetId: string; path: string }[],
      recents: s.recents as { path: string; name: string }[],
      notices: s.notices as { level: string; text: string; detail?: string }[],
      tint: s.tint as number,
    };
  });
}
