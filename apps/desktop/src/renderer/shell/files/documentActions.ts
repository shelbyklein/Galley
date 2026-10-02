/**
 * File actions of the editor window: New, Open, Save, Save As, Close, and the prompt that guards them. The window
 * holds one document; New and Open replace it after the unsaved-changes prompt. The renderer parses and serializes
 * documents (@galley/model); the main process shows the panels and touches the disk (src/main/files.ts). Owned by lane C.
 */
import {
  createDocument,
  DocumentParseError,
  historyRevision,
  parseDocument,
  serializeDocument,
  setMeta,
  type GalleyDocument,
} from '@galley/model';
import { bumpAssetGeneration } from '../../../shared/assets';
import type { GalleyApi, OpenedPackage } from '../../../shared/ipc';
import { pageFromSpec, type NewDocumentSpec } from '../../dialogs/presets';
import { selectDoc, selectIsDirty, useEditorStore } from '../../store';
import { useShellStore } from '../shellStore';

function galley(): GalleyApi {
  const api = window.galley;
  if (!api) throw new Error('The file commands need the Electron app (window.galley is missing).');
  return api;
}

/** IPC errors arrive as `Error invoking remote method '...': PackageError: <message>`; show only the message. */
export function readableError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(PackageError|DocumentParseError|Error):\s*/, '');
}

const documentName = (doc: GalleyDocument) => doc.meta.title || 'Untitled';

// ------------------------------------------------------------------------------------------------------------ open

/**
 * Turn a package read from disk into the open document. Returns false (with an error notice) when the model cannot
 * parse it; the document that was open stays open and its images stay served.
 */
export async function applyOpenedPackage(opened: OpenedPackage, options: { remember?: boolean } = {}): Promise<boolean> {
  const shell = useShellStore.getState();
  let doc: GalleyDocument;
  try {
    doc = parseDocument(opened);
  } catch (error) {
    const detail = error instanceof DocumentParseError ? error.message : readableError(error);
    shell.pushNotice({ level: 'error', text: `Could not open “${opened.path.split('/').pop()}”`, detail });
    return false;
  }
  const { missingLinks, recents } = await galley().files.activate(opened.path, { remember: options.remember ?? true });
  bumpAssetGeneration();
  useEditorStore.getState().openDocument(doc);
  useShellStore.getState().setFileState({ packagePath: opened.path, missingLinks, linkWarningDismissed: false, recents });
  const engine = galley().engineVersion;
  if (doc.meta.engineVersion !== engine) {
    useShellStore.getState().pushNotice({
      level: 'warning',
      text: `This document was last saved with Electron ${doc.meta.engineVersion}; this app runs ${engine}.`,
      detail: 'Line breaks in text can differ between versions.',
    });
  }
  return true;
}

export async function openDocument(): Promise<void> {
  if (!(await confirmUnsavedChanges('opening'))) return;
  try {
    const opened = await galley().files.open();
    if (opened) await applyOpenedPackage(opened);
  } catch (error) {
    useShellStore.getState().pushNotice({ level: 'error', text: 'Could not open the document', detail: readableError(error) });
  }
}

export async function openRecentFile(packagePath: string): Promise<void> {
  if (!(await confirmUnsavedChanges('opening'))) return;
  try {
    await applyOpenedPackage(await galley().files.openPath(packagePath));
  } catch (error) {
    useShellStore.getState().pushNotice({ level: 'error', text: 'Could not open the document', detail: readableError(error) });
    useShellStore.getState().setFileState({ recents: await galley().files.recents() });
  }
}

export async function clearRecentFiles(): Promise<void> {
  useShellStore.getState().setFileState({ recents: await galley().files.clearRecents() });
}

// ------------------------------------------------------------------------------------------------------------- new

/** File > New: the New Document dialog, then a fresh untitled document. */
export async function newDocument(): Promise<void> {
  if (useShellStore.getState().dialog) return; // one dialog at a time
  if (!(await confirmUnsavedChanges('creating'))) return;
  const spec = await new Promise<NewDocumentSpec | null>((resolve) =>
    useShellStore.getState().openDialog({ kind: 'newDocument', resolve }),
  );
  if (!spec) return;
  const made = pageFromSpec(spec);
  if (!made.page) return; // the dialog does not let an invalid spec through; this is the safety net
  const doc = createDocument({
    title: 'Untitled',
    engineVersion: galley().engineVersion,
    page: { width: spec.width, height: spec.height, margins: spec.margins, columns: spec.columns, bleed: spec.bleed, slug: spec.slug },
  });
  await galley().files.newDocument();
  useEditorStore.getState().openDocument(doc);
  useShellStore.getState().setFileState({ packagePath: null, missingLinks: [], linkWarningDismissed: false });
}

// ------------------------------------------------------------------------------------------------------------ save

/**
 * Save the document to its package, or ask where when it has none (or `saveAs`). Resolves true when it was written,
 * false when the user cancelled the Save As panel. The first save of an untitled document names it after the file.
 */
export async function saveDocument(saveAs = false): Promise<boolean> {
  try {
    return await writeDocument(saveAs);
  } catch (error) {
    useShellStore.getState().pushNotice({ level: 'error', text: 'Could not save the document', detail: readableError(error) });
    return false;
  }
}

async function writeDocument(saveAs: boolean): Promise<boolean> {
  const api = galley();
  const shell = useShellStore.getState();
  let target = shell.packagePath;
  if (saveAs || !target) {
    const suggestedName = documentName(selectDoc(useEditorStore.getState()));
    const chosen = await api.files.chooseSavePath({ suggestedName, currentPath: target });
    if (!chosen) return false;
    target = chosen;
    const base = chosen.split('/').pop()!.replace(/\.galley$/i, '');
    if (/^Untitled/i.test(selectDoc(useEditorStore.getState()).meta.title)) {
      useEditorStore.getState().dispatch(setMeta, { title: base });
    }
  }
  useEditorStore.getState().closeCoalescing();
  const state = useEditorStore.getState();
  const doc = selectDoc(state);
  const revision = historyRevision(state.history);
  const files = serializeDocument(doc, { engineVersion: api.engineVersion });
  const result = await api.files.save({ files, assetPaths: Object.values(doc.assets).map((a) => a.path), path: target });
  // an edit made while the files were being written leaves the document dirty, which is right
  if (historyRevision(useEditorStore.getState().history) === revision) useEditorStore.getState().markSaved();
  useShellStore.getState().setFileState({ packagePath: result.path, missingLinks: result.missingLinks, recents: result.recents });
  return true;
}

// ------------------------------------------------------------------------------------------------------ unsaved work

/**
 * The Save / Don't Save / Cancel prompt, when there are unsaved changes. Resolves true when it is fine to go ahead
 * (nothing to save, saved, or discarded) and false when the user cancelled.
 */
export async function confirmUnsavedChanges(action: 'closing' | 'opening' | 'creating' | 'quitting'): Promise<boolean> {
  const state = useEditorStore.getState();
  if (!selectIsDirty(state)) return true;
  const choice = await galley().files.confirmUnsaved({ name: documentName(selectDoc(state)), action });
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return saveDocument(false);
}

/** File > Close (and the window's red button, Cmd-Q): the prompt, then the window closes. */
export async function closeDocument(): Promise<void> {
  if (!(await confirmUnsavedChanges('closing'))) {
    await galley().files.cancelClose();
    return;
  }
  await galley().files.closeWindow();
}
