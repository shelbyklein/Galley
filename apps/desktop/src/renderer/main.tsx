import '@galley/render/fonts';
import * as model from '@galley/model';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerCoreCommands } from './commands/core';
import { installKeyboardShortcuts } from './commands/keyboard';
import { commands } from './commands/registry';
import { useEditorStore } from './store';
import './theme.css';

/** TEMPORARY (lane C replaces it with real File > Open): open the package the main process was told to open at startup. */
async function openInitialDocument(): Promise<void> {
  const files = await window.galley?.getInitialDocument();
  if (!files) return;
  try {
    useEditorStore.getState().openDocument(model.parseDocument(files));
  } catch (error) {
    console.error('Could not open the document', error);
  }
}

async function main(): Promise<void> {
  registerCoreCommands(useEditorStore);
  installKeyboardShortcuts();
  await openInitialDocument();

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
