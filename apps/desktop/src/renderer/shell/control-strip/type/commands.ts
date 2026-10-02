import { clearOverrides } from './targets';
import { commands } from '../../../commands/registry';
import { useEditorStore } from '../../../store';
import { useTypeStore } from './typeStore';
export function registerTypeCommands(): void {
  window.addEventListener('galley:caret-state', (event) => useTypeStore.getState().setCaret((event as CustomEvent).detail));
  commands.registerAll([
    ...(['character', 'paragraph'] as const).map((mode) => ({ id: `type.${mode}`, label: mode === 'character' ? 'Character' : 'Paragraph', category: 'Type' as const, shortcut: mode === 'character' ? 'Mod+T' : 'Mod+Alt+T', run: () => {
      useTypeStore.getState().setMode(mode);
      useEditorStore.getState().setActiveTool('type');
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="type-control-strip"] input, [data-testid="type-control-strip"] select')?.focus());
    } })),
    { id: 'type.clearOverrides', label: 'Clear Overrides', category: 'Type', run: () => clearOverrides() },
  ]);
}
