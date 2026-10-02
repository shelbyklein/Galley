// Side-effect module (imported once from renderer/main.tsx): registers File > Export > PDF/X-4… (`file.exportPdf`, ⌘E)
// and mounts the export dialog in a root of its own, so no shared file needs to know about it. Lane A.
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { commands } from '../../commands/registry';
import { ExportDialog } from './ExportDialog';
import { exportDialog } from './exportState';

let mounted = false;

/** Mount the dialog host (once). It renders nothing until the dialog opens. */
function mountDialogHost(): void {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.id = 'galley-export-dialog-host';
  document.body.appendChild(host);
  createRoot(host).render(createElement(ExportDialog));
}

export function registerExportCommand(registry = commands): () => void {
  return registry.register({
    id: 'file.exportPdf',
    label: 'Export PDF/X-4…',
    category: 'File',
    shortcut: 'Mod+E',
    run: () => {
      mountDialogHost();
      exportDialog.open();
    },
  });
}

if (!commands.has('file.exportPdf')) registerExportCommand();
