import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPdfRequest, ExportPdfResponse, ExportProgress, PressBridge } from '../../../shared/export-ipc';
import { CommandRegistry } from '../../commands/registry';
import { exportDialog } from './exportState';
import { registerExportCommand } from './register';

describe('the file.exportPdf command', () => {
  it('is registered under File with ⌘E, as the menu builder expects', () => {
    const registry = new CommandRegistry();
    registerExportCommand(registry);
    expect(registry.get('file.exportPdf')).toMatchObject({ label: 'Export PDF/X-4…', category: 'File', shortcut: 'Mod+E' });
    expect(registry.byCategory('File').map((c) => c.id)).toEqual(['file.exportPdf']);
  });
});

describe('the export dialog state', () => {
  let request: ExportPdfRequest | null;
  let respond: ExportPdfResponse;
  let progressListener: ((p: ExportProgress) => void) | null;

  beforeEach(() => {
    request = null;
    progressListener = null;
    respond = { status: 'canceled' };
    const press: PressBridge = {
      async exportPdf(r) {
        request = r;
        progressListener?.({ stage: 'rendering', message: 'Rendering the page' });
        return respond;
      },
      onExportProgress(listener) {
        progressListener = listener;
        return () => {
          progressListener = null;
        };
      },
      getProfileInfo: async () => ({ kind: 'press', name: 'Coated GRACoL 2006', note: null }),
      softProof: async () => null,
    };
    vi.stubGlobal('window', { galley: { press, engineVersion: '44.5.1', e2e: false } });
    exportDialog.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    exportDialog.reset();
  });

  it('opens with bleed and crop marks on, and the options can be changed', () => {
    exportDialog.open();
    expect(exportDialog.get()).toMatchObject({ open: true, phase: 'options', options: { bleed: true, marks: true } });
    exportDialog.setOption('bleed', false);
    expect(exportDialog.get().options).toEqual({ bleed: false, marks: true });
  });

  it('sends the current document with the chosen options, and shows the result', async () => {
    respond = {
      status: 'saved',
      summary: { path: '/tmp/x.pdf', bytes: 1234, profile: { name: 'Coated GRACoL 2006', kind: 'press' }, sheet: { width: 684, height: 864 }, trim: { width: 612, height: 792 }, spots: [], warnings: ['Type 3'] },
    };
    exportDialog.open();
    exportDialog.setOption('marks', false);
    await exportDialog.run();
    expect(request!.options).toEqual({ bleed: true, marks: false });
    expect(JSON.parse(request!.files.document).formatVersion).toBe(1);
    expect(request!.files.document).toContain('"engineVersion": "44.5.1"'); // the document as the editor holds it, stamped with the running engine
    expect(request!.suggestedName).toBe('Untitled');
    expect(exportDialog.get()).toMatchObject({ phase: 'done', summary: { path: '/tmp/x.pdf' } });
  });

  it('reports progress while it runs', async () => {
    const seen: string[] = [];
    const off = exportDialog.subscribe(() => {
      const p = exportDialog.get().progress;
      if (p) seen.push(p.message);
    });
    exportDialog.open();
    await exportDialog.run();
    off();
    expect(seen).toContain('Rendering the page');
  });

  it('goes back to the options when the save dialog is canceled, and shows an error with a way back', async () => {
    exportDialog.open();
    await exportDialog.run();
    expect(exportDialog.get().phase).toBe('options');
    respond = { status: 'error', message: 'Could not save the PDF: EACCES' };
    await exportDialog.run();
    expect(exportDialog.get()).toMatchObject({ phase: 'error', error: 'Could not save the PDF: EACCES' });
    exportDialog.retry();
    expect(exportDialog.get().phase).toBe('options');
  });

  it('cannot be closed or changed while an export runs', async () => {
    let finish!: (r: ExportPdfResponse) => void;
    (window.galley!.press as { exportPdf: PressBridge['exportPdf'] }).exportPdf = () => new Promise((resolve) => (finish = resolve));
    exportDialog.open();
    const running = exportDialog.run();
    expect(exportDialog.get().phase).toBe('running');
    exportDialog.close();
    exportDialog.setOption('bleed', false);
    expect(exportDialog.get()).toMatchObject({ open: true, options: { bleed: true } });
    finish({ status: 'canceled' });
    await running;
    expect(exportDialog.get().phase).toBe('options');
  });
});
