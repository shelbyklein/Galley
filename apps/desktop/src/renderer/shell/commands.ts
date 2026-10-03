/**
 * The commands lane C registers (the rest of the registry comes from lanes A and B and from core.ts):
 *
 *   file.new file.open file.save file.saveAs file.close file.clearRecent
 *   tool.selection tool.type tool.line tool.rectangleFrame tool.rectangle tool.ellipse tool.hand tool.zoom
 *   window.pages window.layers window.swatches
 *   proxy.toggleTarget proxy.swap
 *
 * `edit.undo` and `edit.redo` are registered in ../commands/core.ts. Tool commands only set the store's active tool;
 * what a tool does on the canvas is lane B's.
 */
import { setFrameProps, type Id, type Paint, type Stroke } from '@galley/model';
import { commands, type Command, type CommandRegistry } from '../commands/registry';
import { selectDoc, useEditorStore, type ToolId } from '../store';
import { clearRecentFiles, closeDocument, newDocument, openDocument, saveDocument } from './files/documentActions';
import { PANEL_IDS, PANEL_TITLES, useShellStore, type PanelId } from './shellStore';

/** One tool: its command, its button in the Tools column, and the store tool it activates. */
export interface ToolDef {
  id: string;
  tool: ToolId;
  label: string;
  shortcut: string;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'tool.selection', tool: 'select', label: 'Selection Tool', shortcut: 'V' },
  { id: 'tool.type', tool: 'type', label: 'Type Tool', shortcut: 'T' },
  { id: 'tool.line', tool: 'line', label: 'Line Tool', shortcut: '\\' },
  { id: 'tool.rectangleFrame', tool: 'rectangle-frame', label: 'Rectangle Frame Tool', shortcut: 'F' },
  { id: 'tool.rectangle', tool: 'rectangle', label: 'Rectangle Tool', shortcut: 'M' },
  { id: 'tool.ellipse', tool: 'ellipse', label: 'Ellipse Tool', shortcut: 'L' },
  { id: 'tool.hand', tool: 'hand', label: 'Hand Tool', shortcut: 'H' },
  { id: 'tool.zoom', tool: 'zoom', label: 'Zoom Tool', shortcut: 'Z' },
];

const PANEL_SHORTCUTS: Partial<Record<PanelId, string>> = { pages: 'F12', layers: 'F7', swatches: 'F5', paragraphStyles: 'Mod+F11', characterStyles: 'Mod+Shift+F11',textWrap:'Mod+Alt+W' };

/** The leaf frames the proxy's fill and stroke apply to: the selection, with groups expanded. */
function selectedLeafIds(): Id[] {
  const state = useEditorStore.getState();
  const doc = selectDoc(state);
  const out: Id[] = [];
  const visit = (id: Id) => {
    const f = doc.frames[id];
    if (!f) return;
    if (f.type === 'group') f.childIds.forEach(visit);
    else out.push(id);
  };
  state.selection.forEach(visit);
  return out;
}

/** Shift+X: swap the fill and stroke paints of the selection (a stroke keeps its weight). */
function swapFillAndStroke(): void {
  const state = useEditorStore.getState();
  const doc = selectDoc(state);
  const leaves = selectedLeafIds().filter((id) => doc.frames[id]!.type !== 'line');
  if (leaves.length === 0) return;
  state.beginTransaction('Swap Fill and Stroke');
  try {
    for (const id of leaves) {
      const f = doc.frames[id] as { fill: Paint | null; stroke: Stroke | null };
      const fill: Paint | null = f.stroke ? f.stroke.paint : null;
      const stroke: Stroke | null = f.fill ? { paint: f.fill, weight: f.stroke?.weight ?? 1 } : null;
      useEditorStore.getState().dispatch(setFrameProps, { ids: [id], props: { fill, stroke } });
    }
  } finally {
    useEditorStore.getState().commitTransaction();
  }
}

export function shellCommands(): Command[] {
  const store = useEditorStore;
  const shell = useShellStore;
  const list: Command[] = [
    { id: 'file.new', label: 'New…', category: 'File', shortcut: 'Mod+N', run: () => newDocument() },
    { id: 'file.open', label: 'Open…', category: 'File', shortcut: 'Mod+O', run: () => openDocument() },
    { id: 'file.save', label: 'Save', category: 'File', shortcut: 'Mod+S', run: () => saveDocument(false).then(() => undefined) },
    { id: 'file.saveAs', label: 'Save As…', category: 'File', shortcut: 'Mod+Shift+S', run: () => saveDocument(true).then(() => undefined) },
    { id: 'file.close', label: 'Close', category: 'File', shortcut: 'Mod+W', run: () => closeDocument() },
    { id: 'file.clearRecent', label: 'Clear Menu', run: () => clearRecentFiles(), enabled: () => shell.getState().recents.length > 0 },
    ...TOOLS.map(
      (t): Command => ({ id: t.id, label: t.label, category: 'Tools', shortcut: t.shortcut, run: () => store.getState().setActiveTool(t.tool) }),
    ),
    ...PANEL_IDS.map(
      (p): Command => ({
        id: `window.${p}`,
        label: PANEL_TITLES[p],
        category: 'Window',
        shortcut: PANEL_SHORTCUTS[p],
        run: () => shell.getState().togglePanelVisible(p),
      }),
    ),
    {
      id: 'proxy.toggleTarget',
      label: 'Toggle Fill and Stroke',
      shortcut: 'X',
      run: () => shell.getState().setProxyTarget(shell.getState().proxyTarget === 'fill' ? 'stroke' : 'fill'),
    },
    { id: 'proxy.swap', label: 'Swap Fill and Stroke', shortcut: 'Shift+X', run: swapFillAndStroke, enabled: () => store.getState().selection.length > 0 },
  ];
  return list;
}

/** Register the shell's commands. Returns an unregister function. */
export function registerShellCommands(registry: CommandRegistry = commands): () => void {
  return registry.registerAll(shellCommands());
}

/** `window.*` menu items are check marks: checked while the panel is shown. */
export function isPanelCommandChecked(id: string): boolean | undefined {
  const panel = PANEL_IDS.find((p) => `window.${p}` === id);
  return panel ? useShellStore.getState().panels[panel].visible : undefined;
}
