import type { Page } from '@playwright/test';
import { loadDoc } from '../canvas/helpers';
export async function specimen(page: Page): Promise<void> {
  await loadDoc(page, { frames: [
    { id: 'a', type: 'text', x: 54, y: 60, w: 320, h: 240, text: 'Alphabet typography gives the page a clear voice.\nParagraph spacing creates rhythm for readers. This specimen uses Inter only, with editable styles and precise leading.' },
    { id: 'b', type: 'text', x: 54, y: 330, w: 320, h: 180, text: 'A second use follows the same Body style. Changes to its definition update every use.' },
  ] });
  await page.evaluate(() => {
    const g = (window as any).__galley; g.store.getState().setSelection(['a']);
    const shell = (window as any).__galleyShell.store.getState();
    for (const p of ['pages', 'layers', 'swatches']) shell.setPanel(p, { collapsed: true });
    shell.setPanel('characterStyles', { visible: true, collapsed: true });
    shell.setPanel('paragraphStyles', { visible: true, collapsed: false });
    g.store.getState().setActiveTool('type');
  });
}
export async function selectRange(page: Page, storyId = 'story_a', anchor = 1, head = 49): Promise<void> {
  await page.evaluate((selection) => (window as any).__galley.store.getState().setTextSelection(selection), { storyId, anchor, head });
}
export async function field(page: Page, name: string, value: string, scope = '[data-testid="type-control-strip"]'): Promise<void> {
  const el = page.locator(`${scope} [data-field="${name}"]`);
  await el.fill(value); await el.press('Enter');
}
export async function styleCreate(page: Page, kind: 'paragraph' | 'character', name: string, basedOn?: string): Promise<string> {
  const panel = page.locator(`[data-panel="${kind}Styles"]`);
  if (await panel.getAttribute('data-collapsed') === 'true') await panel.locator('.gl-panel-header').click();
  await panel.getByRole('button', { name: `New ${kind} style`, exact: true }).click();
  await panel.getByTestId('style-name').fill(name);
  if (basedOn !== undefined) await panel.getByTestId('style-based-on').selectOption({ label: basedOn });
  const id = await page.locator(`[data-testid="${kind}-style-editor"]`).getAttribute('data-style-id');
  return id ?? '';
}
export async function saveStyle(page: Page, kind: 'paragraph' | 'character'): Promise<void> {
  await page.locator(`[data-testid="${kind}-style-editor"]`).getByRole('button', { name: 'Save Style', exact: true }).click();
}
