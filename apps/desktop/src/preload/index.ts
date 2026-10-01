// Preload script: the only bridge between the sandboxed renderer and the main process. Owned by lane C.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('galley', {
  engineVersion: process.versions.electron,
});
