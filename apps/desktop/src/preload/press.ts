// The export and soft-proof half of the preload bridge (`window.galley.press`). Lane A; preload/index.ts only mounts it.
import { ipcRenderer } from 'electron';
import { EXPORT_IPC, type ExportProgress, type PressBridge } from '../shared/export-ipc';

export const pressBridge: PressBridge = {
  exportPdf: (request) => ipcRenderer.invoke(EXPORT_IPC.exportPdf, request),
  onExportProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => listener(progress);
    ipcRenderer.on(EXPORT_IPC.exportProgress, handler);
    return () => {
      ipcRenderer.removeListener(EXPORT_IPC.exportProgress, handler);
    };
  },
  getProfileInfo: () => ipcRenderer.invoke(EXPORT_IPC.profileInfo),
  softProof: (inks) => ipcRenderer.invoke(EXPORT_IPC.softProof, inks),
};
