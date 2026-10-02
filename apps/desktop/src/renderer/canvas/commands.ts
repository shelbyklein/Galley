/**
 * The canvas's commands: View (zoom, rulers, guides, units), Edit (selection and clipboard), Object (group, arrange,
 * fitting) and File > Place. Lane C builds the menus and the control strip from these ids; shortcuts follow InDesign.
 *
 * Commands that act on objects stand down (`enabled` false) while a gesture has a transaction open, and the clipboard
 * commands also while a text field or the text editor has the keyboard, so ⌘C, ⌘V, ⌘A and Backspace keep their text meaning
 * there: the keyboard handler sees a disabled command and leaves the key to the browser.
 */
import type { StoreApi } from 'zustand/vanilla';
import { commands as appCommands, type Command, type CommandRegistry } from '../commands/registry';
import type { EditorState } from '../store';
import {
  arrangeSelection,
  canGroup,
  canUngroup,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  hasClipboard,
  pasteClipboard,
  selectAll,
  ungroupSelection,
} from '../tools/actions';
import { applyFit, fittableFrames, placeImage, type FitMode } from '../tools/place';
import { normalizeSelection } from '../tools/selection-model';
import { isTypingNow } from './dom';
import { fitPageInWindow, zoomStepAboutCenter, zoomToAboutCenter } from './view-actions';

type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

/** Build the canvas commands for a store. Exported for tests; the app registers them through ./register. */
export function canvasCommands(store: StoreLike): Command[] {
  const s = () => store.getState();
  const idle = () => !s().history.pending;
  const selection = () => normalizeSelection(s().history.doc, s().selection);
  const hasSelection = () => idle() && selection().length > 0;
  const textKeys = () => idle() && !isTypingNow();

  const view = (id: string, label: string, run: () => void, shortcut?: string): Command => ({ id, label, category: 'View', shortcut, run });
  const edit = (id: string, label: string, run: () => void, enabled: () => boolean, shortcut?: string, category: Command['category'] = 'Edit'): Command => ({ id, label, category, shortcut, run, enabled });
  const object = (id: string, label: string, run: () => void, enabled: () => boolean, shortcut?: string): Command => edit(id, label, run, enabled, shortcut, 'Object');
  const fit = (id: string, label: string, mode: FitMode, shortcut: string): Command => object(id, label, () => void applyFit(store, mode), () => idle() && fittableFrames(s().history.doc, s().selection).length > 0, shortcut);

  return [
    // ---- View
    view('view.zoomIn', 'Zoom In', () => zoomStepAboutCenter(store, 'in'), 'Mod+='),
    view('view.zoomOut', 'Zoom Out', () => zoomStepAboutCenter(store, 'out'), 'Mod+-'),
    view('view.fitPage', 'Fit Page in Window', () => fitPageInWindow(store), 'Mod+0'),
    view('view.actualSize', 'Actual Size', () => zoomToAboutCenter(store, 1), 'Mod+1'),
    view('view.toggleRulers', 'Show/Hide Rulers', () => s().setView({ rulersVisible: !s().view.rulersVisible }), 'Mod+R'),
    view('view.toggleGuides', 'Show/Hide Guides', () => s().setView({ guidesVisible: !s().view.guidesVisible }), 'Mod+;'),
    view('view.units.pt', 'Points', () => s().setView({ units: 'pt' })),
    view('view.units.in', 'Inches', () => s().setView({ units: 'in' })),
    view('view.units.mm', 'Millimeters', () => s().setView({ units: 'mm' })),

    // ---- Edit
    edit('edit.selectAll', 'Select All', () => selectAll(store), textKeys, 'Mod+A'),
    edit('edit.deselectAll', 'Deselect All', () => s().clearSelection(), () => textKeys() && s().selection.length > 0, 'Mod+Shift+A'),
    edit('edit.cut', 'Cut', () => void cutSelection(store), () => textKeys() && selection().length > 0, 'Mod+X'),
    edit('edit.copy', 'Copy', () => void copySelection(store), () => textKeys() && selection().length > 0, 'Mod+C'),
    edit('edit.paste', 'Paste', () => void pasteClipboard(store), () => textKeys() && hasClipboard(), 'Mod+V'),
    edit('edit.pasteInPlace', 'Paste in Place', () => void pasteClipboard(store, { inPlace: true }), () => textKeys() && hasClipboard(), 'Mod+Alt+Shift+V'),
    edit('edit.duplicate', 'Duplicate', () => void duplicateSelection(store), () => textKeys() && selection().length > 0, 'Mod+Alt+Shift+D'),
    edit('edit.delete', 'Delete', () => void deleteSelection(store), () => textKeys() && selection().length > 0, 'Backspace'),

    // ---- Object
    object('object.group', 'Group', () => void groupSelection(store), () => idle() && canGroup(s().history.doc, selection()), 'Mod+G'),
    object('object.ungroup', 'Ungroup', () => void ungroupSelection(store), () => idle() && canUngroup(s().history.doc, selection()), 'Mod+Shift+G'),
    object('object.bringForward', 'Bring Forward', () => void arrangeSelection(store, 'forward'), hasSelection, 'Mod+]'),
    object('object.sendBackward', 'Send Backward', () => void arrangeSelection(store, 'backward'), hasSelection, 'Mod+['),
    object('object.bringToFront', 'Bring to Front', () => void arrangeSelection(store, 'front'), hasSelection, 'Mod+Shift+]'),
    object('object.sendToBack', 'Send to Back', () => void arrangeSelection(store, 'back'), hasSelection, 'Mod+Shift+['),

    // ---- Object > Fitting
    fit('object.fit.fillProportionally', 'Fill Frame Proportionally', 'fillProportionally', 'Mod+Alt+Shift+C'),
    fit('object.fit.fitProportionally', 'Fit Content Proportionally', 'fitProportionally', 'Mod+Alt+Shift+E'),
    fit('object.fit.contentToFrame', 'Fit Content to Frame', 'contentToFrame', 'Mod+Alt+E'),
    fit('object.fit.center', 'Center Content', 'center', 'Mod+Shift+E'),

    // ---- File
    {
      id: 'file.place',
      label: 'Place…',
      category: 'File',
      shortcut: 'Mod+D',
      enabled: idle,
      run: async () => {
        try {
          await placeImage(store);
        } catch (error) {
          console.error('Place failed', error);
          window.alert(error instanceof Error ? error.message : String(error));
        }
      },
    },
  ];
}

/** Register the canvas commands. Returns an unregister function. */
export function registerCanvasCommands(store: StoreLike, registry: CommandRegistry = appCommands): () => void {
  return registry.registerAll(canvasCommands(store));
}
