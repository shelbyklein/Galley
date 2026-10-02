import { FIXTURES } from '../helpers/launch';
import { test, expect } from '../helpers/fixtures';
import { getEditorState, runCommand } from '../helpers/app-state';
import { expectBaseline, snap } from '../helpers/screenshot';
import { clickMenuItem, findItem, getShellState, readGalleyMenus, readMenu, setSelection } from './helpers';

// P1-12: the shell, the menu bar built from the command registry, the tools column and its shortcuts, and docked panels.
test.use({ open: FIXTURES.posterBasic });

test.describe('menu bar', () => {
  test('lists File, Edit, Object, Type, View and Window with their items', async ({ galley }) => {
    const menus = await readGalleyMenus(galley.app);
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'Object', 'Type', 'View', 'Window']);
    const labels = (name: string) => menus.find((m) => m.label === name)!.items!.filter((i) => i.type !== 'separator').map((i) => i.label);

    expect(labels('File')).toEqual(['New…', 'Open…', 'Open Recent', 'Close', 'Save', 'Save As…', 'Place…', 'Export PDF/X-4…']);
    expect(labels('Edit')).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Duplicate', 'Delete', 'Select All', 'Deselect All']);
    expect(labels('Object')).toEqual(['Group', 'Ungroup', 'Arrange', 'Fitting']);
    expect(labels('View').slice(0, 7)).toEqual(['Zoom In', 'Zoom Out', 'Fit Page in Window', 'Actual Size', 'Rulers', 'Guides', 'Units']);
    expect(labels('Window').slice(0, 3)).toEqual(['Pages', 'Layers', 'Swatches']);

    // submenus
    const objectMenu = menus.find((m) => m.label === 'Object')!;
    expect(findItem(objectMenu.items, (n) => n.label === 'Arrange')!.items!.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual([
      'Bring to Front',
      'Bring Forward',
      'Send Backward',
      'Send to Back',
    ]);
    expect(findItem(objectMenu.items, (n) => n.label === 'Fitting')!.items!.map((i) => i.id)).toEqual([
      'object.fit.fillProportionally',
      'object.fit.fitProportionally',
      'object.fit.contentToFrame',
      'object.fit.center',
    ]);
  });

  test('shows the shortcuts of the commands lane C registers, and disables items nobody has registered yet', async ({ galley }) => {
    const menus = await readGalleyMenus(galley.app);
    const item = (id: string) => findItem(menus, (n) => n.id === id)!;
    expect(item('file.save')).toMatchObject({ label: 'Save', enabled: true, accelerator: 'CmdOrCtrl+S' });
    expect(item('file.saveAs')).toMatchObject({ enabled: true, accelerator: 'CmdOrCtrl+Shift+S' });
    expect(item('file.new')).toMatchObject({ accelerator: 'CmdOrCtrl+N' });
    expect(item('file.open')).toMatchObject({ accelerator: 'CmdOrCtrl+O' });
    expect(item('file.close')).toMatchObject({ accelerator: 'CmdOrCtrl+W' });
    expect(item('edit.redo')).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+Z' });
    expect(item('window.layers')).toMatchObject({ accelerator: 'F7', type: 'checkbox', checked: true });
    // single-key shortcuts stay with the window (a native accelerator would swallow typing): no tool item has one
    expect(findItem(menus, (n) => n.id.startsWith('tool.'))).toBeUndefined();

    // commands that lanes A and B register are in the menu, disabled until they exist
    const registered = await galley.page.evaluate(() => (window as unknown as { __galley: { commands: { list(): { id: string }[] } } }).__galley.commands.list().map((c) => c.id));
    for (const id of ['file.place', 'file.exportPdf', 'edit.cut', 'object.group', 'view.zoomIn', 'object.fit.center']) {
      if (!registered.includes(id)) expect(item(id).enabled, `${id} is not registered, so it is disabled`).toBe(false);
    }
  });

  test('Undo follows the document: disabled with nothing to undo, then named after the last change', async ({ galley }) => {
    const { page, app } = galley;
    const undo = async () => findItem(await readGalleyMenus(app), (n) => n.id === 'edit.undo')!;
    await expect.poll(async () => (await undo()).enabled).toBe(false);
    await page.evaluate(() => {
      const g = (window as unknown as { __galley: { store: { getState(): any }; model: any } }).__galley;
      g.store.getState().dispatch(g.model.moveFrames, { ids: ['spring'], dx: 6, dy: 0 });
    });
    await expect.poll(async () => (await undo()).label).toBe('Undo Move');
    expect((await undo()).enabled).toBe(true);
    await clickMenuItem(app, 'edit.undo');
    await expect.poll(async () => (await undo()).enabled).toBe(false);
    expect((await getEditorState(page)).undoSteps).toBe(0);
  });

  test('clicking a menu item runs its command', async ({ galley }) => {
    const { page, app } = galley;
    expect((await getShellState(page)).panels.layers!.visible).toBe(true);
    await clickMenuItem(app, 'window.layers');
    await expect.poll(async () => (await getShellState(page)).panels.layers!.visible).toBe(false);
    await expect(page.locator('[data-panel="layers"]')).toHaveCount(0);
    await expect.poll(async () => findItem(await readGalleyMenus(app), (n) => n.id === 'window.layers')!.checked).toBe(false);
    await clickMenuItem(app, 'window.layers');
    await expect(page.locator('[data-panel="layers"]')).toHaveCount(1);
  });

  test('has a menu even before the registry fills: the macOS application menu comes first', async ({ galley }) => {
    const all = await readMenu(galley.app);
    if (process.platform === 'darwin') expect(all[0]!.id).not.toMatch(/^menu:/);
    expect(all.filter((m) => m.id.startsWith('menu:'))).toHaveLength(6);
  });
});

test.describe('menu accelerators and the key handler', () => {
  /** Stand-ins for commands lane B registers, which count how often they run. */
  async function registerCounters(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      const g = (window as unknown as { __galley: { commands: { has(id: string): boolean; register(c: unknown): void } } }).__galley;
      const w = window as unknown as { __runs: Record<string, number> };
      w.__runs = {};
      const count = (id: string) => () => void (w.__runs[id] = (w.__runs[id] ?? 0) + 1);
      if (!g.commands.has('edit.selectAll')) g.commands.register({ id: 'edit.selectAll', label: 'Select All', category: 'Edit', shortcut: 'Mod+A', run: count('edit.selectAll') });
      g.commands.register({ id: 'edit.stand-in', label: 'Stand In', category: 'Edit', shortcut: 'Mod+Shift+U', run: count('edit.stand-in') });
    });
  }
  const runs = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __runs: Record<string, number> }).__runs);

  test('a command another lane registers appears in its menu with its accelerator', async ({ galley }) => {
    const { page, app } = galley;
    await registerCounters(page);
    await expect.poll(async () => findItem(await readGalleyMenus(app), (n) => n.id === 'edit.stand-in')?.accelerator).toBe('CmdOrCtrl+Shift+U');
    expect(findItem(await readGalleyMenus(app), (n) => n.id === 'edit.selectAll')).toMatchObject({ enabled: true });
  });

  test('a key press and its menu accelerator run the command once, in either order', async ({ galley }) => {
    const { page, app } = galley;
    await registerCounters(page);
    await expect.poll(async () => findItem(await readGalleyMenus(app), (n) => n.id === 'edit.stand-in')?.enabled).toBe(true);
    // the key handler runs it ...
    await page.keyboard.press('Meta+Shift+u');
    expect((await runs(page))['edit.stand-in']).toBe(1);
    // ... and a menu click that arrives as the same key press (an OS that fires both) is dropped
    await clickMenuItem(app, 'edit.stand-in');
    expect((await runs(page))['edit.stand-in']).toBe(1);
    // a menu click on its own, later, runs it
    await page.waitForTimeout(300);
    await clickMenuItem(app, 'edit.stand-in');
    await expect.poll(async () => (await runs(page))['edit.stand-in']).toBe(2);
    // the menu first, then the key press for the same stroke: the key is dropped
    await page.waitForTimeout(300);
    await clickMenuItem(app, 'edit.stand-in');
    await page.keyboard.press('Meta+Shift+u');
    await expect.poll(async () => (await runs(page))['edit.stand-in']).toBe(3);
  });

  test('Edit > Select All edits the text of a focused field instead of running the document command', async ({ galley }) => {
    const { page, app } = galley;
    await registerCounters(page);
    await setSelection(page, ['photo-frame']);
    await expect.poll(async () => findItem(await readGalleyMenus(app), (n) => n.id === 'edit.selectAll')?.enabled).toBe(true);
    await page.locator('[data-field="x"]').click();
    await page.locator('[data-field="x"]').evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await clickMenuItem(app, 'edit.selectAll');
    await expect.poll(() => page.locator('[data-field="x"]').evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 5]);
    expect((await runs(page))['edit.selectAll'] ?? 0).toBe(0); // the document command did not run
    await page.keyboard.press('Escape');
    // with the canvas focused it is the document command
    await page.waitForTimeout(150);
    await clickMenuItem(app, 'edit.selectAll');
    await expect.poll(async () => (await runs(page))['edit.selectAll']).toBe(1);
  });

  test('typing Cmd-A, C, V, X or Z in a field never runs a document command', async ({ galley }) => {
    const { page } = galley;
    await registerCounters(page);
    await setSelection(page, ['photo-frame']);
    await page.locator('[data-field="x"]').click();
    for (const key of ['a', 'c', 'x', 'z']) await page.keyboard.press(`Meta+${key}`);
    expect((await runs(page))['edit.selectAll'] ?? 0).toBe(0);
    expect((await getEditorState(page)).undoSteps).toBe(0);
  });

  test('a modal dialog owns the keyboard: shortcuts do nothing behind it', async ({ galley }) => {
    const { page } = galley;
    await page.keyboard.press('Meta+n');
    await expect(page.getByTestId('new-document-dialog')).toBeVisible();
    await page.getByTestId('dialog-cancel').focus();
    await page.keyboard.press('m');
    await page.keyboard.press('t');
    expect((await getEditorState(page)).activeTool).toBe('select');
    await page.keyboard.press('Meta+n'); // a second New does not stack a second dialog
    await expect(page.getByTestId('new-document-dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-document-dialog')).toHaveCount(0);
    await page.keyboard.press('m');
    expect((await getEditorState(page)).activeTool).toBe('rectangle');
  });

  test('Tab stays inside a dialog', async ({ galley }) => {
    const { page } = galley;
    await page.keyboard.press('Meta+n');
    const dialog = page.getByTestId('new-document-dialog');
    await dialog.getByTestId('dialog-ok').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="new-document-dialog"]'))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="new-document-dialog"]'))).toBe(true);
  });
});

const TOOL_KEYS: { key: string; tool: string; command: string }[] = [
  { key: 'v', tool: 'select', command: 'tool.selection' },
  { key: 't', tool: 'type', command: 'tool.type' },
  { key: '\\', tool: 'line', command: 'tool.line' },
  { key: 'f', tool: 'rectangle-frame', command: 'tool.rectangleFrame' },
  { key: 'm', tool: 'rectangle', command: 'tool.rectangle' },
  { key: 'l', tool: 'ellipse', command: 'tool.ellipse' },
  { key: 'h', tool: 'hand', command: 'tool.hand' },
  { key: 'z', tool: 'zoom', command: 'tool.zoom' },
];

test.describe('tools', () => {
  test('each shortcut activates its tool: store state and the highlighted button', async ({ galley }) => {
    const { page } = galley;
    expect((await getEditorState(page)).activeTool).toBe('select');
    await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
    for (const { key, tool } of [...TOOL_KEYS].reverse()) {
      await page.keyboard.press(key);
      expect((await getEditorState(page)).activeTool, `key ${key}`).toBe(tool);
      await expect(page.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[data-tool="${tool}"]`)).toHaveClass(/is-active/);
      await expect(page.locator('.gl-tool-button.is-active')).toHaveCount(1);
    }
  });

  test('clicking a tool button, or running its command, activates the tool', async ({ galley }) => {
    const { page } = galley;
    await page.locator('[data-tool="ellipse"]').click();
    expect((await getEditorState(page)).activeTool).toBe('ellipse');
    await runCommand(page, 'tool.hand');
    expect((await getEditorState(page)).activeTool).toBe('hand');
    await expect(page.locator('[data-tool="hand"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-tool="ellipse"]')).not.toHaveClass(/is-active/);
  });

  test('registers every tool command with its shortcut', async ({ galley }) => {
    const list = await galley.page.evaluate(() => (window as unknown as { __galley: { commands: { list(): { id: string; shortcut?: string }[] } } }).__galley.commands.list());
    for (const { key, command } of TOOL_KEYS) expect(list.find((c) => c.id === command)?.shortcut?.toLowerCase(), command).toBe(key);
  });

  test('typing in a field does not switch tools', async ({ galley }) => {
    const { page } = galley;
    await setSelection(page, ['photo-frame']);
    await page.locator('[data-field="x"]').click();
    await page.keyboard.type('mtl');
    expect((await getEditorState(page)).activeTool).toBe('select');
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    expect((await getEditorState(page)).activeTool).toBe('rectangle');
  });

  test('the Direct Selection tool is drawn but disabled: it is outside Phase 1', async ({ galley }) => {
    await expect(galley.page.locator('[data-tool="direct-selection"]')).toBeDisabled();
  });
});

test.describe('docked panels', () => {
  test('Pages, Layers and Swatches are docked, and each collapses and expands from its header', async ({ galley }) => {
    const { page } = galley;
    for (const id of ['pages', 'layers', 'swatches']) {
      const panel = page.locator(`[data-panel="${id}"]`);
      await expect(panel).toHaveAttribute('data-collapsed', 'false');
      await expect(panel.locator('.gl-panel-body')).toBeVisible();
      await panel.locator('.gl-panel-header').click();
      await expect(panel).toHaveAttribute('data-collapsed', 'true');
      await expect(panel.locator('.gl-panel-body')).toHaveCount(0);
      expect((await getShellState(page)).panels[id]!.collapsed).toBe(true);
      await panel.locator('.gl-panel-header').click();
      await expect(panel).toHaveAttribute('data-collapsed', 'false');
    }
  });

  test('a collapsed panel gives its room to the others', async ({ galley }) => {
    const { page } = galley;
    const height = async (id: string) => (await page.locator(`[data-panel="${id}"]`).boundingBox())!.height;
    const before = await height('swatches');
    await page.locator('[data-panel="layers"] .gl-panel-header').click();
    expect(await height('layers')).toBe(25); // 24 px header plus its divider
    expect(await height('swatches')).toBeGreaterThan(before + 100);
  });

  test('the dock keeps its width, and the four shell regions are where the mockup puts them', async ({ galley }) => {
    const { page } = galley;
    const box = async (region: string) => (await page.locator(`[data-region="${region}"]`).boundingBox())!;
    expect((await box('dock')).width).toBe(300);
    expect((await box('tools')).width).toBe(44);
    expect((await box('control-strip')).height).toBe(44);
    expect((await box('statusbar')).height).toBe(28);
    await expect(page.locator('.gl-region-label')).toHaveCount(0); // the placeholder captions are gone
  });
});

test('the shell with the poster open and its photo frame selected matches the baseline', async ({ galley }, testInfo) => {
  const { page } = galley;
  await setSelection(page, ['photo-frame']);
  await expect(page.locator('[data-field="x"]')).toHaveValue('36 pt');
  await expect(page.locator('[data-field="y"]')).toHaveValue('516 pt');
  await snap(page, 'shell-poster-selected', { testInfo });
  await expectBaseline(page, 'shell-poster-selected');
});
