import { addSwatch } from '@galley/model';
import { documentSwatchLibrary, prepareSwatchImport } from '../../shared/swatch-library';
import { useEditorStore } from '../store';
import { readableError } from '../shell/files/documentActions';
import { useShellStore } from '../shell/shellStore';

let loading = false;
export async function loadSwatchLibrary(): Promise<void> {
  if (loading || !window.galley) return;
  loading = true;
  const generation = useEditorStore.getState().documentGeneration;
  try {
    const library = await window.galley.swatches.loadLibrary();
    const state = useEditorStore.getState();
    if (!library || state.documentGeneration !== generation) return;
    const { additions, reused } = prepareSwatchImport(state.history.doc, library);
    state.beginTransaction('Import Swatch Library');
    try {
      for (const swatch of additions) useEditorStore.getState().dispatch(addSwatch, { swatch });
      useEditorStore.getState().commitTransaction();
    } catch (e) { useEditorStore.getState().cancelTransaction(); throw e; }
    useShellStore.getState().pushNotice({ level: 'info', text: `Swatch library loaded: ${additions.length} added, ${reused} reused.` });
  } catch (e) {
    if (useEditorStore.getState().documentGeneration === generation) useShellStore.getState().pushNotice({ level: 'error', text: 'Could not load swatch library', detail: readableError(e) });
  } finally { loading = false; }
}

export async function saveSwatchLibrary(): Promise<void> {
  if (!window.galley) return;
  try {
    const library = documentSwatchLibrary(useEditorStore.getState().history.doc);
    if (await window.galley.swatches.saveLibrary(library)) useShellStore.getState().pushNotice({ level: 'info', text: 'Swatch library saved.' });
  } catch (e) { useShellStore.getState().pushNotice({ level: 'error', text: 'Could not save swatch library', detail: readableError(e) }); }
}
