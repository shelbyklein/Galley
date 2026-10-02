import type { FontReportEntry } from '@galley/fonts/types';
// Types and channel names for PDF export and soft proofing, shared by the main process (src/main/export), the preload
// script and the renderer (src/renderer/dialogs/export, src/renderer/status). Owned by lane A, kept apart from
// shared/ipc.ts so the two lanes extend the bridge without touching the same lines.
import type { DocumentFiles } from '@galley/model';

export const EXPORT_IPC = {
  exportPdf: 'galley:export-pdf',
  exportProgress: 'galley:export-progress',
  profileInfo: 'galley:profile-info',
  softProof: 'galley:soft-proof',
} as const;

/** What the user chose in the export dialog. */
export interface ExportPdfOptions {
  /** Include the document's bleed. Off: art is cut at the trim edge. */
  bleed: boolean;
  /** Crop marks and registration targets. */
  marks: boolean;
}

export interface ExportPdfRequest {
  /** The document being exported, as the model serializes it (so unsaved edits are exported, not what is on disk). */
  files: DocumentFiles;
  options: ExportPdfOptions;
  /** Suggested file name, without the extension. */
  suggestedName: string;
  /** Which page to export; the first when omitted. */
  pageId?: string;
}

export type ExportStage = 'rendering' | 'prepress' | 'saving';

export interface ExportProgress {
  stage: ExportStage;
  /** One line for the dialog: `Rendering the page`. */
  message: string;
}

export interface ExportPdfSummary {
  /** Where the PDF was written. */
  path: string;
  bytes: number;
  /** The output profile the PDF is intended for. */
  profile: { name: string; kind: 'press' | 'fallback' };
  /** The sheet and the trim, in points. */
  sheet: { width: number; height: number };
  trim: { width: number; height: number };
  /** Spot colors that print on their own plates. */
  spots: string[];
  /** Things the user should know: fallback profile, Type 3 fonts, unconverted colors. Empty when there is nothing to say. */
  warnings: string[];
  /** Exact font sources and embedding outcomes for the export log. */
  fonts?: FontReportEntry[];
}

export type ExportPdfResponse =
  | { status: 'saved'; summary: ExportPdfSummary }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

/** What the status bar shows about the output profile. */
export interface ProfileInfo {
  /** `press` (the real press profile), `fallback` (Ghostscript's generic CMYK) or `none`. */
  kind: 'press' | 'fallback' | 'none';
  /** `Coated GRACoL 2006`; empty for `none`. */
  name: string;
  /** One sentence explaining a fallback or a missing profile; null when everything is as intended. */
  note: string | null;
}

/** A CMYK ink to proof on screen: percentages 0..100 for C, M, Y, K, already multiplied by the tint. */
export type ProofCmyk = [number, number, number, number];

/** What the preload script exposes to the editor window as `window.galley.press`. */
export interface PressBridge {
  /** Run the export: save dialog, hidden window, printToPDF, prepress, write. Resolves when done (or canceled). */
  exportPdf(request: ExportPdfRequest): Promise<ExportPdfResponse>;
  /** Progress while `exportPdf` runs. Returns an unsubscribe function. */
  onExportProgress(listener: (progress: ExportProgress) => void): () => void;
  /** Which output profile soft proofing and export use. */
  getProfileInfo(): Promise<ProfileInfo>;
  /** Display sRGB (0..255) for each CMYK ink through the output profile, or null when there is no profile. */
  softProof(inks: ProofCmyk[]): Promise<[number, number, number][] | null>;
}
