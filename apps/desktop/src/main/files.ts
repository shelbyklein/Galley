// File commands in the main process: the Open and Save As panels, the unsaved-changes prompt, recent files, and the
// disk work. The renderer owns the document (it parses and serializes with @galley/model); this module owns dialogs and
// the file system. Owned by lane C.
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import {
  IPC,
  type ChooseSavePathRequest,
  type ConfirmChoice,
  type ConfirmRequest,
  type OpenedPackage,
  type RecentFile,
  type SaveRequest,
  type SaveResult,
} from '../shared/ipc';
import {
  discardScratchPackage,
  getActivePackage,
  setActivePackage,
  setMissingLinks,
} from './package';
import { ensureGalleyExtension, findMissingLinks, packageName, readPackageFiles, resolvePackageDir, writePackage } from './packageIO';
import type { RecentFiles } from './recents';

const windowOf = (event: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender);

/** Read a package without making it active: the renderer may still reject it (a document the model cannot parse). */
export function readOpenedPackage(dir: string): OpenedPackage {
  const files = readPackageFiles(dir);
  return { path: dir, ...files, missingLinks: findMissingLinks(dir, files.links) };
}

const CLOSING_VERBS: Record<ConfirmRequest['action'], string> = {
  closing: 'closing',
  opening: 'opening another document',
  creating: 'creating a new document',
  quitting: 'quitting',
};

export interface FileHandlerOptions {
  recents: RecentFiles;
  /** Called when the user cancels a close or quit that the window asked about (so a pending quit is dropped). */
  onCancelClose(): void;
  /** Close the sender's window now (unsaved changes already handled). */
  onCloseWindow(win: BrowserWindow): void;
}

export function registerFileHandlers({ recents, onCancelClose, onCloseWindow }: FileHandlerOptions): void {
  ipcMain.handle(IPC.filesOpen, async (event): Promise<OpenedPackage | null> => {
    const win = windowOf(event);
    const options: Electron.OpenDialogOptions = {
      title: 'Open Galley Document',
      buttonLabel: 'Open',
      defaultPath: app.getPath('documents'),
      // A package is a folder: pick the X.galley folder (or the document.json inside it).
      properties: ['openFile', 'openDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return readOpenedPackage(resolvePackageDir(result.filePaths[0]!));
  });

  ipcMain.handle(IPC.filesOpenPath, (_event, packagePath: string): OpenedPackage => readOpenedPackage(resolvePackageDir(packagePath)));

  // The renderer parsed the package and opened it: now it becomes the active one.
  ipcMain.handle(IPC.filesActivate, (_event, packagePath: string, remember: boolean): { missingLinks: OpenedPackage['missingLinks']; recents: RecentFile[] } => {
    const dir = resolvePackageDir(packagePath);
    const files = readPackageFiles(dir);
    const missingLinks = findMissingLinks(dir, files.links);
    setActivePackage(dir);
    setMissingLinks(missingLinks);
    if (remember) app.addRecentDocument(dir);
    return { missingLinks, recents: remember ? recents.add(dir) : recents.list() };
  });

  ipcMain.handle(IPC.filesChooseSavePath, async (event, request: ChooseSavePathRequest): Promise<string | null> => {
    const win = windowOf(event);
    const options: Electron.SaveDialogOptions = {
      title: 'Save As',
      buttonLabel: 'Save',
      defaultPath: path.join(request.currentPath ? path.dirname(request.currentPath) : app.getPath('documents'), `${request.suggestedName}.galley`),
      filters: [{ name: 'Galley Document', extensions: ['galley'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    return ensureGalleyExtension(result.filePath);
  });

  ipcMain.handle(IPC.filesSave, (_event, request: SaveRequest): SaveResult => {
    const target = ensureGalleyExtension(path.resolve(request.path));
    writePackage(target, request.files, { sourceDir: getActivePackage(), assetPaths: request.assetPaths });
    setActivePackage(target); // an untitled document's scratch package is deleted now that its images are copied
    const missingLinks = findMissingLinks(target, request.files.links);
    setMissingLinks(missingLinks);
    app.addRecentDocument(target);
    return { path: target, missingLinks, recents: recents.add(target) };
  });

  ipcMain.handle(IPC.filesNewDocument, (): void => {
    discardScratchPackage();
    setActivePackage(null);
    setMissingLinks([]);
  });

  ipcMain.handle(IPC.filesConfirmUnsaved, async (event, request: ConfirmRequest): Promise<ConfirmChoice> => {
    const win = windowOf(event);
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save the changes you made to “${request.name}” before ${CLOSING_VERBS[request.action]}?`,
      detail: "Your changes will be lost if you don't save them.",
    };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
  });

  ipcMain.handle(IPC.filesRecents, (): RecentFile[] => recents.list());
  ipcMain.handle(IPC.filesClearRecents, (): RecentFile[] => {
    app.clearRecentDocuments();
    return recents.clear();
  });

  ipcMain.handle(IPC.filesCloseWindow, (event): void => {
    const win = windowOf(event);
    if (win) onCloseWindow(win);
  });
  ipcMain.handle(IPC.filesCancelClose, (): void => onCancelClose());
}

export { packageName };
