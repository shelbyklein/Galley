// Preload script: the only bridge between the sandboxed renderer and the main process. Owned by lane C.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GalleyApi } from '../shared/ipc';

const api: GalleyApi = {
  engineVersion: process.versions.electron,
  e2e: process.env.GALLEY_E2E === '1',
  getInitialDocument: () => ipcRenderer.invoke(IPC.getInitialDocument),
};

contextBridge.exposeInMainWorld('galley', api);
