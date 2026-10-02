import { ipcRenderer } from 'electron';
import type { FontBridge } from '@galley/fonts/types';
export const fontBridge: FontBridge = {
  families: () => ipcRenderer.invoke('galley:font-families'),
  resolve: (requests) => ipcRenderer.invoke('galley:font-resolve', requests),
};
