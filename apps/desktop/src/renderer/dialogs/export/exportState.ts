// State and actions of the Export PDF/X-4 dialog. A small external store (the dialog is its own React root, see mount.tsx),
// so the command, the dialog and tests share one source of truth. Lane A.
import { serializeDocument } from '@galley/model';
import type { ExportPdfOptions, ExportPdfSummary, ExportProgress } from '../../../shared/export-ipc';
import { selectDoc, useEditorStore } from '../../store';

export type ExportPhase = 'options' | 'running' | 'done' | 'error';

export interface ExportDialogState {
  open: boolean;
  phase: ExportPhase;
  options: ExportPdfOptions;
  progress: ExportProgress | null;
  summary: ExportPdfSummary | null;
  error: string | null;
}

const initial = (): ExportDialogState => ({ open: false, phase: 'options', options: { bleed: true, marks: true }, progress: null, summary: null, error: null });

let state: ExportDialogState = initial();
const listeners = new Set<() => void>();

function set(patch: Partial<ExportDialogState>): void {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

export const exportDialog = {
  get: (): ExportDialogState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Open the dialog with the options of the last export (they stay for the session). */
  open(): void {
    if (state.open && state.phase === 'running') return;
    set({ open: true, phase: 'options', progress: null, summary: null, error: null });
  },

  /** Close it. Ignored while an export runs (there is no cancel for a render in progress). */
  close(): void {
    if (state.phase === 'running') return;
    set({ open: false });
  },

  setOption<K extends keyof ExportPdfOptions>(key: K, value: ExportPdfOptions[K]): void {
    if (state.phase === 'running') return;
    set({ options: { ...state.options, [key]: value } });
  },

  /** Choose the file, render, convert, save. Resolves when the export has finished, failed or was canceled in the save dialog. */
  async run(): Promise<void> {
    const bridge = window.galley?.press;
    if (!bridge) {
      set({ phase: 'error', error: 'PDF export is only available in the Galley app.' });
      return;
    }
    if (state.phase === 'running') return;
    const doc = selectDoc(useEditorStore.getState());
    const files = serializeDocument(doc, { engineVersion: window.galley?.engineVersion });
    set({ phase: 'running', progress: { stage: 'rendering', message: 'Choosing the file' }, summary: null, error: null });
    const off = bridge.onExportProgress((progress) => set({ progress }));
    try {
      const response = await bridge.exportPdf({ files, options: state.options, suggestedName: doc.meta.title });
      if (response.status === 'saved') set({ phase: 'done', summary: response.summary, progress: null });
      else if (response.status === 'canceled') set({ phase: 'options', progress: null });
      else set({ phase: 'error', error: response.message, progress: null });
    } catch (error) {
      set({ phase: 'error', error: error instanceof Error ? error.message : String(error), progress: null });
    } finally {
      off();
    }
  },

  /** Back to the options after an error, to change something and try again. */
  retry(): void {
    if (state.phase === 'error') set({ phase: 'options', error: null });
  },

  /** For tests. */
  reset(): void {
    state = initial();
    for (const l of [...listeners]) l();
  },
};
