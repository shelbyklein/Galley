/**
 * The command registry: the one list of things the user can do.
 *
 * Everything with a name, a menu item or a shortcut is a Command here:
 *   - lane C builds the menu bar and the context menus from `commands.list()` / `commands.byCategory()`
 *   - lane B registers the tool commands (`tool.select`, `tool.rectangle`, ...) and edit commands (group, arrange)
 *   - the global key handler (./keyboard.ts) finds a command by shortcut and runs it
 *   - tests drive the app through `commands.execute(id)` instead of synthesizing keys when the key is not the point
 *
 * A command's `run` and `enabled` close over the store (`useEditorStore.getState()`), so a command registered once
 * keeps working as state changes. `enabled` is polled by menus whenever the store changes.
 *
 * Ids are dotted and lower case: `edit.undo`, `tool.rectangle`, `object.group`, `file.export-pdf`.
 */
import { detectPlatform, matchesShortcut, type Platform, type ShortcutEvent } from './shortcuts';

/** Menu a command is listed under. Lane C may extend this union when it adds menus. */
export type CommandCategory = 'File' | 'Edit' | 'Object' | 'Type' | 'View' | 'Window' | 'Tools';

export interface Command {
  /** Stable dotted id, unique across the app. */
  id: string;
  /** Menu label, for example `Undo` or `Group`. Title case, no ellipsis unless a dialog opens (`Export…`). */
  label: string;
  /** Menu this command is listed under; omit for commands that have no menu item. */
  category?: CommandCategory;
  /** Shortcut string, see ./shortcuts.ts: `Mod+Shift+Z`, `V`, `Mod+]`. */
  shortcut?: string;
  /** Does the work. May be async (dialogs, file I/O). */
  run: () => void | Promise<void>;
  /** Whether the command can run right now. Omit for always enabled. */
  enabled?: () => boolean;
}

type Listener = () => void;

export class CommandRegistry {
  private readonly byId = new Map<string, Command>();
  private readonly listeners = new Set<Listener>();
  private cachedList: readonly Command[] | null = null;

  /** Add a command. Returns an unregister function. Throws on a duplicate id, so two lanes cannot silently clash. */
  register(command: Command): () => void {
    if (this.byId.has(command.id)) throw new Error(`Command "${command.id}" is already registered`);
    this.byId.set(command.id, command);
    this.changed();
    return () => {
      if (this.byId.get(command.id) === command) {
        this.byId.delete(command.id);
        this.changed();
      }
    };
  }

  registerAll(commands: readonly Command[]): () => void {
    const offs = commands.map((c) => this.register(c));
    return () => offs.forEach((off) => off());
  }

  get(id: string): Command | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** All commands in registration order. The array identity changes only when the set of commands changes. */
  list(): readonly Command[] {
    if (!this.cachedList) this.cachedList = [...this.byId.values()];
    return this.cachedList;
  }

  /** Commands for one menu, in registration order. */
  byCategory(category: CommandCategory): Command[] {
    return this.list().filter((c) => c.category === category);
  }

  isEnabled(id: string): boolean {
    const c = this.byId.get(id);
    if (!c) return false;
    return c.enabled ? c.enabled() : true;
  }

  /** Run a command if it exists and is enabled. Resolves true when it ran. Errors from `run` propagate. */
  async execute(id: string): Promise<boolean> {
    const c = this.byId.get(id);
    if (!c) throw new Error(`Unknown command "${id}"`);
    if (c.enabled && !c.enabled()) return false;
    await c.run();
    return true;
  }

  /** The command bound to this key event, or undefined. The first registered command wins on a conflict. */
  findByShortcut(event: ShortcutEvent, platform: Platform = detectPlatform()): Command | undefined {
    return this.list().find((c) => c.shortcut && matchesShortcut(event, c.shortcut, platform));
  }

  /** Called whenever commands are added or removed. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.cachedList = null;
    this.listeners.forEach((l) => l());
  }
}

/** The app-wide registry. */
export const commands = new CommandRegistry();
