// Electron main process entry. Owned by lane C (shell, files, menus) except src/main/export/ (lane A)
// and src/main/fonts/ (lane N). Lane F only provides the minimum needed to open the editor window.
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { IPC, type PackageFiles } from '../shared/ipc';
import { registerExportHandlers } from './export';
import { registerPlaceImage } from './place-image';
import { handleAssetProtocol, initialPackagePath, readPackage, registerAssetScheme, setActivePackage } from './package';

/** Set by Playwright e2e runs (apps/desktop/e2e/helpers/launch.ts). */
const E2E = process.env.GALLEY_E2E === '1';

if (E2E) {
  // Pixel-exact screenshots regardless of the display the tests run on.
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

registerAssetScheme();

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

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(`${devUrl}/renderer/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  handleAssetProtocol();
  registerExportHandlers(); // lane A: File > Export > PDF/X-4 and soft proofing (main/export)
  // TEMPORARY: open one package at startup (lane C replaces this with real File > Open / New).
  ipcMain.handle(IPC.getInitialDocument, (): PackageFiles | null => {
    const dir = initialPackagePath();
    if (!dir) return null;
    setActivePackage(dir);
    return readPackage(dir);
  });
  registerPlaceImage();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || E2E) app.quit();
});
