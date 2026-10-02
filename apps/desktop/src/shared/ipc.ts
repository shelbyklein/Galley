// Types and channel names shared by the main process, the preload script and the renderer windows.
import type { PressBridge } from './export-ipc';

/** The model's two files of a `.galley` package, as text. Parsing and validating them is @galley/model's job. */
export interface PackageFiles {
  document: string;
  /** Absent when the package has no links.json (a document without images). */
  links?: string;
}

/** An image the user chose with File > Place, already linked into the package (lane B: src/main/place-image). */
export interface PlacedImage {
  /** Relative path inside the package: `assets/<name>`. */
  path: string;
  /** `sha256:<64 hex digits>` of the file. */
  hash: string;
  width: number;
  height: number;
  /** Native resolution recorded in the file (72 when none). */
  ppi: number;
  colorSpace: 'rgb' | 'cmyk' | 'gray';
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
  /** File > Place: show the open dialog, link the chosen image into the package, describe it. Null when cancelled. */
  placeImage(): Promise<PlacedImage | null>;
}

export const IPC = {
  getInitialDocument: 'galley:get-initial-document',
  placeImage: 'galley:place-image',
} as const;
