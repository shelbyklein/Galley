import '@galley/render/fonts';
import * as model from '@galley/model';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './canvas/register';
import { registerCoreCommands } from './commands/core';
import { installKeyboardShortcuts } from './commands/keyboard';
import { commands } from './commands/registry';
import { startShell } from './shell/boot';
import { useEditorStore } from './store';
import './dialogs/export/register'; // lane A: File > Export > PDF/X-4… (⌘E) and its dialog
import './status/register'; // lane A: soft proofing through the output profile
import './theme.css';

async function main(): Promise<void> {
  registerCoreCommands(useEditorStore);
  installKeyboardShortcuts();
  await startShell(); // lane C: shell commands, native menu, startup document

  if (window.galley?.e2e) {
    // e2e tests read and drive the app through this (see e2e/helpers/app-state.ts); it does not exist in normal runs.
    window.__galley = { store: useEditorStore, commands, model };
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
