/// <reference types="vite/client" />
import type { GalleyApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Exposed by the preload script. Absent when the renderer runs outside Electron (unit tests). */
    galley?: GalleyApi;
    /** Test hook, present only when `window.galley.e2e` is true. See renderer/main.tsx. */
    __galley?: unknown;
  }
}
