import { commands, type CommandRegistry } from './registry';

/** Elements that own the keyboard: typing in them must not trigger single-key tool shortcuts. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Install the window-level key handler that runs the command bound to a shortcut. Returns an uninstall function.
 *
 * Commands whose shortcut has no modifier (`V`, `T`, `M`) are skipped while an input or a contenteditable has focus.
 * Lane C may replace this with native menu accelerators; keep only one of the two active for a given shortcut.
 */
export function installKeyboardShortcuts(registry: CommandRegistry = commands, target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const command = registry.findByShortcut(event);
    if (!command) return;
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (!hasModifier && isEditableTarget(event.target)) return;
    if (!registry.isEnabled(command.id)) return;
    event.preventDefault();
    void Promise.resolve(command.run()).catch((error: unknown) => {
      console.error(`Command ${command.id} failed`, error);
    });
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
