import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('galleyHost', {
  exportAndCheck: (lines: unknown, slots: unknown) => ipcRenderer.invoke('export-check', lines, slots),
});
