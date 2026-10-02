import { pageIdOf, setStoryDoc, type Id, type PMNode } from '@galley/model';
import { htmlFrameStyle, pt, sheetGeometry } from '@galley/render';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { patchCanvasState } from '../../canvas/canvasState';
import { selectDoc, useEditorStore } from '../../store';
import { docToEditable, editableToDoc } from './dom';

/** Leave in-place editing: the typing so far stays one undo step, and the next edit starts a new one. */
export function exitTextEdit(): void {
  patchCanvasState({ textEdit: null });
  useEditorStore.getState().closeCoalescing();
}

function placeCaret(el: HTMLElement, caret: 'end' | { clientX: number; clientY: number }): void {
  const selection = window.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  if (caret !== 'end') {
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const at = doc.caretRangeFromPoint?.(caret.clientX, caret.clientY) ?? null;
    if (at && el.contains(at.startContainer)) range = at;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * In-place text editing of one text frame (plain text with bold and italic runs that keeps paragraph styles, local overrides and
 * character styles intact, see dom.ts; P2-03 replaces it with the ProseMirror view). The editable sits exactly over the frame,
 * inside the same scaled layer as the page, with the story's typography but transparent text: the page renderer underneath draws the text from the model, which every input writes
 * to, so what you see while typing is what is stored. All typing in one session is a single undo step (a coalesced
 * `story.setDoc`). ⌘Z while editing undoes in the model and the editable follows.
 */
export function TextEditor({ frameId, caret }: { frameId: Id; caret: 'end' | { clientX: number; clientY: number } }) {
  const doc = useEditorStore(selectDoc);
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<PMNode | null>(null);
  const composing = useRef(false);

  const frame = doc.frames[frameId];
  const story = frame?.type === 'text' ? doc.stories[frame.storyId] : undefined;

  // mount: fill from the story, focus, place the caret
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !story) return;
    docToEditable(el, story.doc, doc);
    shown.current = story.doc;
    el.focus();
    placeCaret(el, caret);
    document.execCommand('defaultParagraphSeparator', false, 'p');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId]);

  // the story changed behind the editor's back (undo, redo): show it
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !story || story.doc === shown.current) return;
    docToEditable(el, story.doc, doc);
    shown.current = story.doc;
    placeCaret(el, 'end');
  }, [story]);

  // the frame or its story is gone (undo of the draw, delete): nothing to edit
  useLayoutEffect(() => {
    if (!story) exitTextEdit();
  }, [story]);

  if (!frame || frame.type !== 'text' || !story) return null;
  const page = doc.pages[pageIdOf(doc, frameId) ?? ''];
  if (!page) return null;
  const geo = sheetGeometry(page);
  // the typography is on the paragraphs and runs (docToEditable), exactly as the page draws them
  const style: CSSProperties = {
    ...htmlFrameStyle(frame, geo.origin),
    padding: frame.inset > 0 ? pt(frame.inset) : undefined,
  };

  const commit = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const next = editableToDoc(el, doc);
    if (JSON.stringify(next) === JSON.stringify(story.doc)) return;
    const store = useEditorStore.getState();
    store.dispatch(setStoryDoc, { storyId: story.id, doc: next }, { coalesceKey: `edit:${story.id}`, label: 'Edit Text' });
    shown.current = useEditorStore.getState().history.doc.stories[story.id]?.doc ?? null;
  };

  return (
    <div
      ref={ref}
      className="galley-text gl-text-editor"
      data-testid="text-editor"
      data-text-editor=""
      data-editing-frame={frameId}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={style}
      onInput={commit}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onBlur={() => exitTextEdit()}
      onPaste={(e) => {
        // plain text only: bold and italic come from the story, never from pasted markup
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onDrop={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          exitTextEdit();
          ref.current?.blur();
        }
      }}
    />
  );
}
