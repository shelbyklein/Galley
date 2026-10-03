// Preload script: the only bridge between the sandboxed renderer and the main process. Owned by lane C.
// Lanes A and B add their own entries to `api` (export, place image); keep the object additive so merges are a union.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GalleyApi, type MenuCommandMessage } from '../shared/ipc';
import { fontBridge } from './fonts';
import { pressBridge } from './press';

const api: GalleyApi = {
  fonts: fontBridge,
  press: pressBridge, // lane A: PDF export and soft proofing (preload/press.ts)
  engineVersion: process.versions.electron,
  e2e: process.env.GALLEY_E2E === '1',
  getInitialDocument: () => ipcRenderer.invoke(IPC.getInitialDocument),
  placeImage: () => ipcRenderer.invoke(IPC.placeImage),

  images: {
    check: (assets) => ipcRenderer.invoke(IPC.imagesCheck, assets),
    relink: (asset) => ipcRenderer.invoke(IPC.imagesRelink, asset),
  },

  files: {
    open: () => ipcRenderer.invoke(IPC.filesOpen),
    openPath: (path) => ipcRenderer.invoke(IPC.filesOpenPath, path),
    activate: (path, options) => ipcRenderer.invoke(IPC.filesActivate, path, options?.remember ?? true),
    chooseSavePath: (request) => ipcRenderer.invoke(IPC.filesChooseSavePath, request),
    save: (request) => ipcRenderer.invoke(IPC.filesSave, request),
    newDocument: () => ipcRenderer.invoke(IPC.filesNewDocument),
    confirmUnsaved: (request) => ipcRenderer.invoke(IPC.filesConfirmUnsaved, request),
    recents: () => ipcRenderer.invoke(IPC.filesRecents),
    clearRecents: () => ipcRenderer.invoke(IPC.filesClearRecents),
    closeWindow: () => ipcRenderer.invoke(IPC.filesCloseWindow),
    cancelClose: () => ipcRenderer.invoke(IPC.filesCancelClose),
  },

  setDocumentState: (state) => ipcRenderer.send(IPC.setDocumentState, state),
  setMenu: (spec) => ipcRenderer.send(IPC.setMenu, spec),
  textEdit: (action) => ipcRenderer.send(IPC.textEdit, action),
  onMenuCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: MenuCommandMessage) => listener(message);
    ipcRenderer.on(IPC.menuCommand, handler);
    return () => ipcRenderer.removeListener(IPC.menuCommand, handler);
  },
  onCloseRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.closeRequested, handler);
    return () => ipcRenderer.removeListener(IPC.closeRequested, handler);
  },
  shellReady: () => ipcRenderer.send(IPC.shellReady),
};

contextBridge.exposeInMainWorld('galley', api);
