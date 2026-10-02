// Types and channel names shared by the main process, the preload script and the renderer windows.
import type { PressBridge } from './export-ipc';

/** The model's two files of a `.galley` package, as text. Parsing and validating them is @galley/model's job. */
export interface PackageFiles {
  document: string;
  /** Absent when the package has no links.json (a document without images). */
  links?: string;
}

/** What the preload script exposes to renderer windows as `window.galley`. Lane C extends this with file I/O. */
export interface GalleyApi {
  /** PDF/X-4 export and soft proofing (lane A; see shared/export-ipc.ts). */
  press: PressBridge;
  /** `process.versions.electron`: stamped into documents as `meta.engineVersion`. */
  engineVersion: string;
  /** True when the app was started by an e2e test (GALLEY_E2E=1): the renderer then exposes `window.__galley` for tests. */
  e2e: boolean;
  /**
   * TEMPORARY (lane C replaces it with real File > Open): the package to open at startup, from `--open <path>`,
   * the GALLEY_OPEN environment variable, or, under `npm run dev`, fixtures/poster-basic.galley. Null for none.
   */
  getInitialDocument(): Promise<PackageFiles | null>;
}

export const IPC = {
  getInitialDocument: 'galley:get-initial-document',
} as const;
