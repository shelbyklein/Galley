import type { Page } from '@playwright/test';

/**
 * Reading and driving the running app from tests. In e2e runs (GALLEY_E2E=1) the renderer exposes
 * `window.__galley = { store, commands, model }`:
 *   store     the editor store (zustand): `store.getState()` has history, selection, viewport, activeTool, actions
 *   commands  the command registry (`commands.execute('edit.undo')`)
 *   model     everything exported by @galley/model (commands such as `model.moveFrames`, `model.serializeDocument`)
 * Prefer asserting on the model (these helpers) as well as on pixels: "the frame is at x = 36" is exact, a screenshot is not.
 */

interface Hook {
  store: { getState(): any };
  commands: { execute(id: string): Promise<boolean>; list(): { id: string }[] };
  model: any;
}

/** The canonical serialization of the current document (document.json text): equal documents give equal strings. */
export async function getDocumentJson(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    return g.model.serializeDocument(g.store.getState().history.doc).document as string;
  });
}

/** The current document as a plain object. */
export async function getDocument<T = any>(page: Page): Promise<T> {
  return JSON.parse(await getDocumentJson(page)) as T;
}

/** The non-document editor state: selection, active tool, viewport, current page, undo/redo availability, dirty flag. */
export async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __galley: Hook }).__galley;
    const s = g.store.getState();
    return {
      selection: s.selection as string[],
      activeTool: s.activeTool as string,
      viewport: s.viewport as { zoom: number; panX: number; panY: number; fit: boolean },
      currentPageId: s.currentPageId as string,
      undoSteps: s.history.past.length as number,
      redoSteps: s.history.future.length as number,
      dirty: g.model.historyRevision(s.history) !== s.savedRevision,
    };
  });
}

/** Run a registered command by id, as a menu item or shortcut would. */
export async function runCommand(page: Page, id: string): Promise<boolean> {
  return page.evaluate((cmd) => (window as unknown as { __galley: Hook }).__galley.commands.execute(cmd), id);
}
