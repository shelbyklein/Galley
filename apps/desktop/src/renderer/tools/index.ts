// Tools module (lane B owns apps/desktop/src/renderer/tools/**): what each tool does on the canvas, keyed on the store's
// `activeTool` (select, type, line, rectangle, rectangle-frame, ellipse, hand, zoom). Lane C's tool commands (`tool.*`)
// only set the active tool; the pointer handling, selection model, object actions and place/fit logic live here.
export { beginToolGesture, cursorFor, handleDoubleClick, normalizeTool, type Tool } from './tools';
export { applyFit, fitContent, placeImage, type FitMode } from './place';
export { arrangeSelection, copySelection, cutSelection, deleteSelection, duplicateSelection, groupSelection, pasteClipboard, selectAll, ungroupSelection } from './actions';
export { exitTextEdit, TextEditor } from './text-edit/TextEditor';
