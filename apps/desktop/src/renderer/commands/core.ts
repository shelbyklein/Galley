import { canRedo, canUndo } from '@galley/model';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../store/editorStore';
import { commands, type CommandRegistry } from './registry';

/**
 * Commands that belong to no tool or panel: Undo and Redo. (Lane B adds tool and edit commands, lane C file and
 * window commands, each from its own module via `commands.register`.) Returns an unregister function.
 */
export function registerCoreCommands(store: Pick<StoreApi<EditorState>, 'getState'>, registry: CommandRegistry = commands): () => void {
  return registry.registerAll([
    {
      id: 'edit.undo',
      label: 'Undo',
      category: 'Edit',
      shortcut: 'Mod+Z',
      run: () => store.getState().undo(),
      enabled: () => canUndo(store.getState().history),
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      category: 'Edit',
      shortcut: 'Mod+Shift+Z',
      run: () => store.getState().redo(),
      enabled: () => canRedo(store.getState().history),
    },
  ]);
}
