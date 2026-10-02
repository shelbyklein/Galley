import path from 'node:path';
import { test, expect } from '../helpers/fixtures';
import { expectBaseline, snap } from '../helpers/screenshot';
test.use({ open: path.join(__dirname, 'fixtures/type-specimen.galley') });
test('Inter type specimen opens as an editable layered-style document', async ({ galley }) => {
  const { page } = galley;
  await page.evaluate(() => {
    const g = (window as any).__galley;
    g.store.getState().setSelection(['a']); g.store.getState().setActiveTool('type');
    const s = (window as any).__galleyShell.store.getState();
    for (const p of ['pages','layers','swatches']) s.setPanel(p, { collapsed: true });
    s.setPanel('paragraphStyles',{visible:true,collapsed:false});
  });
  await expect(page.locator('[data-style-id="body"]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-frame-id="a"] p').first()).toHaveCSS('font-size','13.3333px');
  await snap(page,'type-specimen'); await expectBaseline(page,'type-specimen');
});
