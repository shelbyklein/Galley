// Electron main process entry. Owned by lane C (shell, files, menus) except src/main/export/ (lane A)
// and src/main/fonts/ (lane N).
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { IPC, type DocumentState, type MenuCommandMessage, type MenuItemSpec, type OpenedPackage, type TextEditAction } from '../shared/ipc';
import { readOpenedPackage, registerFileHandlers } from './files';
import { applyMenuSpec, installStartupMenu, NO_WINDOW_COMMANDS, setMenuDispatcher, setNoWindowMode } from './menu';
import { discardScratchPackage, handleAssetProtocol, initialPackagePath, registerAssetScheme } from './package';
import { RecentFiles } from './recents';

/** Set by Playwright e2e runs (apps/desktop/e2e/helpers/launch.ts). */
const E2E = process.env.GALLEY_E2E === '1';

app.setName('Galley');

if (E2E) {
  // Pixel-exact screenshots regardless of the display the tests run on.
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

// Where recent files and other per-user state live. e2e runs get a fresh folder so tests never see (or change) the real
// profile; GALLEY_USER_DATA picks a folder explicitly (a test that restarts the app with the same profile).
const userDataOverride = process.env.GALLEY_USER_DATA || (E2E ? fs.mkdtempSync(join(os.tmpdir(), 'galley-e2e-profile-')) : '');
if (userDataOverride) app.setPath('userData', userDataOverride);

registerAssetScheme();

// ------------------------------------------------------------------------------------------------ window state

/** What each window's renderer last reported about its document (dirty flag, title, saved path). */
const documentStates = new Map<number, DocumentState>();
/** Windows the user has already answered the unsaved-changes prompt for: let them close. */
const closeApproved = new Set<number>();
/** The renderer has booted and registered its menu listener; menu commands wait until then. */
const rendererReady = new Set<number>();
const pendingMenuMessages = new Map<number, MenuCommandMessage[]>();
/** A quit (Cmd-Q) is waiting for the user to answer the unsaved-changes prompt. */
let quitting = false;
/** The first window gets the startup document (`--open`, GALLEY_OPEN); later windows start blank. */
let initialWindowId: number | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1d1d1f',
    title: 'Galley',
    // The editor draws its own 28px title bar (see renderer/shell); the native traffic lights float over it.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 8 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const id = win.webContents.id;
  if (initialWindowId === null) initialWindowId = id;
  setNoWindowMode(false);

  win.once('ready-to-show', () => win.show());

  // Closing with unsaved changes: ask the renderer to run the Save / Don't Save / Cancel prompt, then close for real.
  win.on('close', (event) => {
    const state = documentStates.get(id);
    const bypass = closeApproved.has(id) || (E2E && quitting);
    if (bypass || !state?.dirty || win.webContents.isDestroyed() || win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send(IPC.closeRequested);
  });
  win.on('closed', () => {
    documentStates.delete(id);
    closeApproved.delete(id);
    rendererReady.delete(id);
    pendingMenuMessages.delete(id);
    if (BrowserWindow.getAllWindows().length === 0) {
      discardScratchPackage();
      setNoWindowMode(true);
    }
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(`${devUrl}/renderer/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/renderer/index.html'));
  }
  return win;
}

// ------------------------------------------------------------------------------------------------ menu routing

function sendMenuCommand(win: BrowserWindow, message: MenuCommandMessage): void {
  const id = win.webContents.id;
  if (rendererReady.has(id)) {
    win.webContents.send(IPC.menuCommand, message);
  } else {
    pendingMenuMessages.set(id, [...(pendingMenuMessages.get(id) ?? []), message]);
  }
}

setMenuDispatcher((message, clicked) => {
  const win = clicked ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    sendMenuCommand(win, message);
  } else if (NO_WINDOW_COMMANDS.has(message.id)) {
    // macOS: the app is still running with no window; New, Open and Open Recent make one.
    sendMenuCommand(createMainWindow(), message);
  }
});

// ------------------------------------------------------------------------------------------------ startup

app.whenReady().then(() => {
  handleAssetProtocol();
  installStartupMenu();

  registerFileHandlers({
    recents: new RecentFiles(join(app.getPath('userData'), 'recent-files.json')),
    onCancelClose: () => {
      quitting = false;
    },
    onCloseWindow: (win) => {
      closeApproved.add(win.webContents.id);
      win.close();
      if (quitting && !E2E) app.quit();
    },
  });

  // The package to open at startup (`--open <path>`, $GALLEY_OPEN, or the dev fixture); null for a blank document.
  ipcMain.handle(IPC.getInitialDocument, (event): OpenedPackage | null => {
    if (event.sender.id !== initialWindowId) return null;
    const dir = initialPackagePath();
    if (!dir) return null;
    try {
      return readOpenedPackage(dir);
    } catch (error) {
      console.error(`Could not open ${dir}:`, error);
      return null;
    }
  });

  ipcMain.on(IPC.setDocumentState, (event, state: DocumentState) => {
    documentStates.set(event.sender.id, state);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.setDocumentEdited(state.dirty);
    win.setTitle(`${state.title}${state.dirty ? ' — Edited' : ''}`);
    if (process.platform === 'darwin') win.setRepresentedFilename(state.path ?? '');
  });

  ipcMain.on(IPC.setMenu, (_event, spec: MenuItemSpec[]) => applyMenuSpec(spec));

  ipcMain.on(IPC.textEdit, (event, action: TextEditAction) => {
    const contents = event.sender;
    if (action === 'undo') contents.undo();
    else if (action === 'redo') contents.redo();
    else if (action === 'cut') contents.cut();
    else if (action === 'copy') contents.copy();
    else if (action === 'paste') contents.paste();
    else if (action === 'selectAll') contents.selectAll();
  });

  ipcMain.on(IPC.shellReady, (event) => {
    const id = event.sender.id;
    rendererReady.add(id);
    for (const message of pendingMenuMessages.get(id) ?? []) event.sender.send(IPC.menuCommand, message);
    pendingMenuMessages.delete(id);
  });

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => discardScratchPackage());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || E2E) app.quit();
});
