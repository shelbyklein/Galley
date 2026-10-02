import { registerTypeCommands } from './control-strip/type/commands';
/**
 * Starts the shell: registers lane C's commands, opens the startup document, connects the native menu and the window
 * chrome. Called once by renderer/main.tsx, before React renders. Owned by lane C.
 */
import { applyOpenedPackage } from './files/documentActions';
import { registerShellCommands } from './commands';
import { installMenuBridge } from './menu/menuBridge';
import { selectDoc, selectIsDirty, useEditorStore } from '../store';
import { useShellStore } from './shellStore';

/**
 * The active layer follows the selection (as in InDesign): selecting frames that all sit on one layer highlights that
 * layer in the Layers panel, so the next object drawn goes there. (The store keeps it a layer that exists.)
 */
function activeLayerFollowsSelection(): void {
  let previous = useEditorStore.getState().selection;
  useEditorStore.subscribe((state) => {
    if (state.selection === previous) return;
    previous = state.selection;
    const doc = selectDoc(state);
    const layers = new Set(state.selection.map((id) => doc.frames[id]?.layerId));
    if (layers.size === 1) {
      const [layerId] = layers;
      if (layerId && layerId !== state.activeLayerId) state.setActiveLayer(layerId);
    }
  });
}

/** Tell the main process what the window needs for its chrome and for the close prompt. */
function reportDocumentState(): void {
  const api = window.galley;
  if (!api) return;
  let last = '';
  const report = () => {
    const state = useEditorStore.getState();
    const next = { dirty: selectIsDirty(state), title: selectDoc(state).meta.title, path: useShellStore.getState().packagePath };
    const json = JSON.stringify(next);
    if (json === last) return;
    last = json;
    api.setDocumentState(next);
  };
  report();
  useEditorStore.subscribe(report);
  useShellStore.subscribe(report);
}

export async function startShell(): Promise<void> {
  registerShellCommands();
  registerTypeCommands();
  activeLayerFollowsSelection();
  const api = window.galley;
  if (api) {
    installMenuBridge();
    reportDocumentState();
    try {
      const initial = await api.getInitialDocument();
      // the startup document is a launch hook (`--open`, GALLEY_OPEN), not something the user opened: not a "recent"
      if (initial) await applyOpenedPackage(initial, { remember: false });
      useShellStore.getState().setFileState({ recents: await api.files.recents() });
    } catch (error) {
      console.error('Could not open the startup document', error);
    }
    api.shellReady();
  }
  if (api?.e2e) {
    // e2e tests read the shell state through this (see e2e/shell/helpers.ts); it does not exist in normal runs.
    (window as unknown as { __galleyShell: unknown }).__galleyShell = { store: useShellStore };
  }
}
