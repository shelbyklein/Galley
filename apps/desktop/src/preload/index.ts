// Preload script: the only bridge between the sandboxed renderer and the main process. Owned by lane C.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GalleyApi } from '../shared/ipc';
import { pressBridge } from './press';

const api: GalleyApi = {
  press: pressBridge, // lane A: PDF export and soft proofing (preload/press.ts)
  engineVersion: process.versions.electron,
  e2e: process.env.GALLEY_E2E === '1',
  getInitialDocument: () => ipcRenderer.invoke(IPC.getInitialDocument),
};

contextBridge.exposeInMainWorld('galley', api);
