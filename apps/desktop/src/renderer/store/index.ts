import { create } from 'zustand';
import { createEditorState, type EditorState } from './editorStore';

export * from './editorStore';

/**
 * The app-wide editor store, as a React hook with the vanilla API attached:
 *
 *   const doc = useEditorStore(selectDoc);               // in components
 *   useEditorStore.getState().dispatch(moveFrames, ...);  // in event handlers and commands
 */
export const useEditorStore = create<EditorState>()(createEditorState());
