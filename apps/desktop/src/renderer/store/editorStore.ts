/**
 * The editor store: the document and its undo history, plus selection, viewport and the active tool.
 *
 *   document + history   `history` (from @galley/model): the current document and its undo/redo stacks. Changes go
 *                        through `dispatch(command, args)`; nothing writes `history.doc` directly.
 *   selection            ids of the selected frames. NOT part of undo history (undo does not restore selection; it only
 *                        drops ids that no longer exist).
 *   viewport             zoom and pan. NOT part of undo history.
 *   activeTool           NOT part of undo history.
 *
 * This file is shared between lanes: add a slice's fields and actions here, keep each slice's state independent of the
 * others, and never put UI-only state into `history`. Tests build isolated stores with `createEditorStore`; the app
 * uses the singleton `useEditorStore` from ./index.
 */
import {
  applyCommand,
  beginTransaction,
  canRedo,
  canUndo,
  cancelTransaction,
  closeCoalescing,
  commitTransaction,
  createDocument,
  createHistory,
  historyRevision,
  redo,
  redoLabel,
  resetHistory,
  undo,
  undoLabel,
  type ApplyOptions,
  type CommandDef,
  type GalleyDocument,
  type HistoryState,
  type Id,
} from '@galley/model';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { isSelectable } from './selectable';

/** The tools of Phase 1 and 2. Lane B implements their behavior and registers a command per tool. */
export type ToolId = 'select' | 'type' | 'line' | 'rectangle' | 'rectangle-frame' | 'ellipse' | 'hand' | 'zoom';

export interface Viewport {
  /** CSS pixels per point: 1 is 100%, as in InDesign (one point is one screen pixel, 72 ppi). */
  zoom: number;
  /**
   * Where the current page's top-left corner (page point 0, 0, the trim box) sits, in CSS pixels from the top-left of
   * the canvas pasteboard (the area below and to the right of the rulers). Page point (x, y) is at screen pixel
   * `(panX + x * zoom, panY + y * zoom)`. While `fit` is true the canvas computes zoom and pan itself and writes them here.
   */
  panX: number;
  panY: number;
  /** While true the canvas keeps fitting the page to the window; any explicit zoom or pan clears it. */
  fit: boolean;
}

/** Display settings of the canvas (rulers, guides, ruler units). Not part of the document and not in undo history. */
export interface ViewSettings {
  rulersVisible: boolean;
  /** Ruler, margin, column, bleed and slug guides. Hidden guides are not drawn and not snapped to. */
  guidesVisible: boolean;
  /** Units of the rulers (and, for lane C, of the control strip fields). The model is always points. */
  units: DisplayUnits;
}

export type DisplayUnits = 'pt' | 'in' | 'mm';

/** A text selection inside one story, as ProseMirror positions in `story.doc`. `anchor === head` is a caret. */
export interface TextSelection {
  storyId: Id;
  anchor: number;
  head: number;
}

export interface EditorState {
  // ----- document and history
  history: HistoryState;
  /** `historyRevision` at the last save (or open). The document is dirty when it differs from the current revision. */
  savedRevision: number;
  /** Run a command as one undo step (or merged, with `options.coalesceKey`). Throws `CommandError` if it cannot apply. */
  dispatch<A>(command: CommandDef<A>, args: A, options?: ApplyOptions): void;
  /** Group everything until `commitTransaction` into one undo step (a drag). `cancelTransaction` reverts it. */
  beginTransaction(label: string): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  /** End a coalescing run: the next keyed change starts a new undo step. */
  closeCoalescing(): void;
  undo(): void;
  redo(): void;
  /** Replace the document (open, new): resets history, selection and the current page. */
  openDocument(doc: GalleyDocument): void;
  /** Record that the current state is what is on disk. */
  markSaved(): void;

  // ----- selection (not in history)
  selection: Id[];
  /** The page the status bar and page-level actions refer to. */
  currentPageId: Id;
  setSelection(ids: readonly Id[]): void;
  toggleSelection(id: Id): void;
  clearSelection(): void;
  setCurrentPage(id: Id): void;

  // ----- active layer (not in history)
  /**
   * The layer new objects go on: the one highlighted in the Layers panel (lane C), which follows the selection. Always a
   * layer that exists (the top layer by default). Lane B's drawing and placing tools read it.
   */
  activeLayerId: Id | null;
  setActiveLayer(id: Id | null): void;

  // ----- viewport and tool (not in history)
  viewport: Viewport;
  setViewport(patch: Partial<Viewport>): void;
  activeTool: ToolId;
  setActiveTool(tool: ToolId): void;
  /** Rulers, guides and units (View menu). */
  view: ViewSettings;
  setView(patch: Partial<ViewSettings>): void;

  // ----- text editing (not in history)
  /**
   * The selection in the story being edited, or null when no text editor is active. Lane T's editor writes it; lane S's
   * type controls and style panels read it to apply styles and overrides to the selected text (or, when it is null, to
   * the whole stories of the selected text frames).
   */
  textSelection: TextSelection | null;
  setTextSelection(selection: TextSelection | null): void;
}

export type EditorStore = StoreApi<EditorState>;

/** The running Electron version, or `dev` outside the app (unit tests). Stamped into new documents. */
export function currentEngineVersion(): string {
  return (globalThis as { galley?: { engineVersion?: string } }).galley?.engineVersion ?? 'dev';
}

/** A blank Letter document, shown until one is opened. */
export function blankDocument(): GalleyDocument {
  return createDocument({ title: 'Untitled', engineVersion: currentEngineVersion() });
}

/** After the document changes: drop selected ids that no longer exist or sit on a hidden or locked layer, and keep the current page valid. */
function reconcile(state: EditorState, history: HistoryState): Pick<EditorState, 'history' | 'selection' | 'currentPageId' | 'activeLayerId' | 'textSelection'> {
  const doc = history.doc;
  const selection = state.selection.filter((id) => isSelectable(doc, id));
  return {
    history,
    selection: selection.length === state.selection.length ? state.selection : selection,
    currentPageId: doc.pages[state.currentPageId] ? state.currentPageId : doc.pageOrder[0]!,
    activeLayerId: state.activeLayerId && doc.layers[state.activeLayerId] ? state.activeLayerId : topLayerId(doc),
    textSelection: state.textSelection && doc.stories[state.textSelection.storyId] ? state.textSelection : null,
  };
}

/** The topmost layer, the default active layer. */
export function topLayerId(doc: GalleyDocument): Id | null {
  return doc.layerOrder[doc.layerOrder.length - 1] ?? null;
}

export function createEditorState(initial: GalleyDocument = blankDocument()) {
  return (set: StoreApi<EditorState>['setState'], get: StoreApi<EditorState>['getState']): EditorState => {
    const history0 = createHistory(initial);
    const update = (next: HistoryState) => {
      if (next !== get().history) set((s) => reconcile(s, next));
    };
    return {
      history: history0,
      savedRevision: historyRevision(history0),
      dispatch: (command, args, options) => update(applyCommand(get().history, command, args, options)),
      beginTransaction: (label) => update(beginTransaction(get().history, label)),
      commitTransaction: () => update(commitTransaction(get().history)),
      cancelTransaction: () => update(cancelTransaction(get().history)),
      closeCoalescing: () => update(closeCoalescing(get().history)),
      undo: () => update(undo(get().history)),
      redo: () => update(redo(get().history)),
      openDocument: (doc) => {
        const history = resetHistory(get().history, doc);
        set({ history, savedRevision: historyRevision(history), selection: [], currentPageId: doc.pageOrder[0]!, activeLayerId: topLayerId(doc), viewport: { zoom: 1, panX: 0, panY: 0, fit: true }, textSelection: null });
      },
      markSaved: () => {
        const history = closeCoalescing(get().history);
        set({ history, savedRevision: historyRevision(history) });
      },

      selection: [],
      currentPageId: initial.pageOrder[0]!,
      setSelection: (ids) => {
        const doc = get().history.doc;
        const next = [...new Set(ids)].filter((id) => isSelectable(doc, id));
        const cur = get().selection;
        if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) set({ selection: next });
      },
      toggleSelection: (id) => {
        const cur = get().selection;
        get().setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      },
      clearSelection: () => {
        if (get().selection.length > 0) set({ selection: [] });
      },
      setCurrentPage: (id) => {
        if (get().history.doc.pages[id]) set({ currentPageId: id });
      },

      activeLayerId: topLayerId(initial),
      setActiveLayer: (id) => {
        if (id === null || get().history.doc.layers[id]) set({ activeLayerId: id });
      },

      viewport: { zoom: 1, panX: 0, panY: 0, fit: true },
      setViewport: (patch) => set((s) => ({ viewport: { ...s.viewport, ...patch } })),
      activeTool: 'select',
      setActiveTool: (tool) => set({ activeTool: tool }),
      view: { rulersVisible: true, guidesVisible: true, units: 'pt' },
      setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),

      textSelection: null,
      setTextSelection: (selection) => {
        const cur = get().textSelection;
        if (selection === cur) return;
        if (selection && cur && selection.storyId === cur.storyId && selection.anchor === cur.anchor && selection.head === cur.head) return;
        if (selection && !get().history.doc.stories[selection.storyId]) return;
        set({ textSelection: selection });
      },
    };
  };
}

/** An independent store (tests, or a second window). */
export function createEditorStore(initial?: GalleyDocument): EditorStore {
  return createStore<EditorState>()(createEditorState(initial));
}

// ---------------------------------------------------------------------------------------------------------- selectors

export const selectDoc = (s: EditorState): GalleyDocument => s.history.doc;
export const selectCanUndo = (s: EditorState): boolean => canUndo(s.history);
export const selectCanRedo = (s: EditorState): boolean => canRedo(s.history);
export const selectUndoLabel = (s: EditorState): string | null => undoLabel(s.history);
export const selectRedoLabel = (s: EditorState): string | null => redoLabel(s.history);
export const selectIsDirty = (s: EditorState): boolean => historyRevision(s.history) !== s.savedRevision;
export const selectCurrentPage = (s: EditorState) => s.history.doc.pages[s.currentPageId]!;
