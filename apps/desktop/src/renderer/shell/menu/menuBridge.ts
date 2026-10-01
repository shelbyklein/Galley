/**
 * Keeps the native menu in step with the command registry, and runs the commands its items trigger.
 *
 *   registry / store / shell changes ──▶ buildMenuSpec ──▶ window.galley.setMenu(spec)   (only when the description changed)
 *   menu item clicked ◀── window.galley.onMenuCommand ──▶ commands.execute(id)
 *
 * Shortcuts: the window's key handler (../../commands/keyboard.ts) stays the only thing that *runs* a shortcut, so
 * e2e tests that press keys and real use take the same path. Native accelerators are display and fallback. If an
 * accelerator and the key handler both fire for one key press (which depends on how the OS orders them), the second
 * run within `DUPLICATE_WINDOW_MS` is dropped here.
 */
import type { MenuCommandMessage, MenuItemSpec, TextEditAction } from '../../../shared/ipc';
import { commands } from '../../commands/registry';
import { selectRedoLabel, selectUndoLabel, useEditorStore } from '../../store';
import { isPanelCommandChecked } from '../commands';
import { closeDocument, openRecentFile } from '../files/documentActions';
import { useShellStore } from '../shellStore';
import { buildMenuSpec } from './menuSpec';

const DUPLICATE_WINDOW_MS = 120;
const UPDATE_DELAY_MS = 30;

/** Edit commands that mean something else while a text field has the keyboard: they edit the field's text. */
const TEXT_EDIT: Record<string, TextEditAction> = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.cut': 'cut',
  'edit.copy': 'copy',
  'edit.paste': 'paste',
  'edit.selectAll': 'selectAll',
};

export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function currentMenuSpec(dev: boolean): MenuItemSpec[] {
  const editor = useEditorStore.getState();
  return buildMenuSpec({
    registry: commands,
    recents: useShellStore.getState().recents,
    isChecked: isPanelCommandChecked,
    undoLabel: selectUndoLabel(editor),
    redoLabel: selectRedoLabel(editor),
    dev,
  });
}

export function installMenuBridge(): () => void {
  const api = window.galley;
  if (!api) return () => {};

  // ----- menu description out
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = '';
  const push = () => {
    timer = undefined;
    const spec = currentMenuSpec(import.meta.env.DEV);
    const json = JSON.stringify(spec);
    if (json === lastSent) return;
    lastSent = json;
    api.setMenu(spec);
  };
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(push, UPDATE_DELAY_MS);
  };
  const unsubscribers = [commands.subscribe(schedule), useEditorStore.subscribe(schedule), useShellStore.subscribe(schedule)];
  push();

  // ----- duplicate-run guard: key handler vs native accelerator
  let lastKey: { id: string; at: number } | null = null;
  let lastMenu: { id: string; at: number } | null = null;
  const onKeyDownCapture = (event: KeyboardEvent) => {
    const command = commands.findByShortcut(event);
    if (!command) return;
    const now = performance.now();
    if (lastMenu && lastMenu.id === command.id && now - lastMenu.at < DUPLICATE_WINDOW_MS) {
      // the menu already ran this command for this key press
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    lastKey = { id: command.id, at: now };
  };
  window.addEventListener('keydown', onKeyDownCapture, true);

  // ----- menu clicks in
  const onMenuCommand = ({ id, payload }: MenuCommandMessage) => {
    const now = performance.now();
    if (id === 'file.openRecent') {
      if (payload) void openRecentFile(payload);
      return;
    }
    if (lastKey && lastKey.id === id && now - lastKey.at < DUPLICATE_WINDOW_MS) return; // the key handler ran it
    lastMenu = { id, at: now };
    const textAction = TEXT_EDIT[id];
    if (textAction && isEditableElement(document.activeElement)) {
      api.textEdit(textAction);
      return;
    }
    commands.execute(id).catch((error: unknown) => console.error(`Menu command ${id} failed`, error));
  };
  const offMenu = api.onMenuCommand(onMenuCommand);
  const offClose = api.onCloseRequested(() => void closeDocument());

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    unsubscribers.forEach((off) => off());
    window.removeEventListener('keydown', onKeyDownCapture, true);
    offMenu();
    offClose();
  };
}
