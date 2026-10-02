import { transformFrames } from '@galley/model';
import { useEffect } from 'react';
import { deleteSelection } from '../tools/actions';
import { leafFrames, normalizeSelection } from '../tools/selection-model';
import { useEditorStore } from '../store';
import { canvasState, patchCanvasState } from './canvasState';
import { isTypingNow } from './dom';
import { round4 } from './geometry';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Arrow keys move the selection 1 pt (10 pt with shift) in absolute steps; a held key is one undo step. */
export function nudgeSelection(dx: number, dy: number): boolean {
  const s = useEditorStore.getState();
  if (s.history.pending) return false; // a gesture owns the document right now
  const doc = s.history.doc;
  const ids = normalizeSelection(doc, s.selection);
  if (ids.length === 0) return false;
  const changes = leafFrames(doc, ids).map((f) => ({ id: f.id, x: round4(f.x + dx), y: round4(f.y + dy) }));
  s.dispatch(transformFrames, { changes }, { coalesceKey: 'nudge', label: 'Move' });
  return true;
}

/**
 * Keys that belong to the canvas rather than to a menu command: space for the temporary hand tool, arrow keys to nudge,
 * Delete (the forward-delete key; Backspace is the `edit.delete` command). They stand down while a text field or the text
 * editor has the keyboard.
 */
export function useCanvasKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTypingNow()) return;
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!canvasState().spaceHeld) patchCanvasState({ spaceHeld: true, cursor: 'grab' });
        e.preventDefault();
        return;
      }
      const arrow = ARROWS[e.key];
      if (arrow && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const step = e.shiftKey ? 10 : 1;
        if (nudgeSelection(arrow[0] * step, arrow[1] * step)) e.preventDefault();
        return;
      }
      if (e.key === 'Delete' && !e.metaKey && !e.ctrlKey && !e.altKey && !useEditorStore.getState().history.pending) {
        if (deleteSelection(useEditorStore)) e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && canvasState().spaceHeld) patchCanvasState({ spaceHeld: false, cursor: 'default' });
      if (ARROWS[e.key]) useEditorStore.getState().closeCoalescing();
    };
    const onBlur = () => patchCanvasState({ spaceHeld: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
