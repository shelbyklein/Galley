import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../helpers/fixtures';
import { REPO_ROOT } from '../helpers/launch';
import { waitForStable } from '../helpers/screenshot';
const output = path.join(REPO_ROOT, 'build/font-compatibility');
fs.mkdirSync(output, { recursive: true });
for (const name of ['poster-basic', 'swatch-chart', 'typography-marks']) {
  test.describe(name, () => {
    test.use({ open: path.join(REPO_ROOT, 'fixtures/v1', `${name}.galley`) });
    test('keeps legacy bundled face choices and identical screen/export CSS source files', async ({ galley }) => {
      const { page, app } = galley;
      await waitForStable(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const root = await cdp.send('DOM.getDocument');
      const nodes = await cdp.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: '.galley-text span' });
      const platform = [];
      for (const nodeId of nodes.nodeIds) platform.push(await cdp.send('CSS.getPlatformFontsForNode', { nodeId }));
      const styles = await page.locator('.galley-text span').evaluateAll(els => els.map(el => {
        const s = getComputedStyle(el);
        return { text: el.textContent, frame: el.closest('[data-frame-id]')?.getAttribute('data-frame-id'), family: s.fontFamily, weight: s.fontWeight, style: s.fontStyle, synthesis: s.fontSynthesis };
      }));
      const requests = [...new Map(styles.map(s => [JSON.stringify([s.family, s.weight, s.style]), { family: s.family.split(',')[0]!.replaceAll('"', '').trim(), weight: Number(s.weight), style: s.style }])).values()];
      const bindings = await app.evaluate(async (_e, r) => (globalThis as any).__galleyFonts.resolveFonts(r), requests);
      fs.writeFileSync(path.join(output, `${name}-fonts.json`), JSON.stringify({ styles, platform, bindings }, null, 2));
      expect(bindings.every((b: any) => !b.missing && b.face.source === 'bundled')).toBe(true);
      if (name === 'typography-marks') {
        expect(bindings.filter((b: any) => b.style === 'italic' && b.weight >= 800).map((b: any) => b.face.weight)).toEqual([700, 700]);
        for (let i = 0; i < styles.length; i++) if (styles[i]!.style === 'italic' && Number(styles[i]!.weight) >= 800) {
          expect(platform[i]!.fonts.map((f: any) => f.postScriptName)).toEqual(['Inter-BoldItalic']);
        }
      }
      const families = await page.evaluate(() => (window as any).galley.fonts.families());
      expect(families.find((f: any) => f.family === 'Inter').faces.map((f: any) => [f.weight, f.style])).toEqual([
        [400, 'italic'], [400, 'normal'], [700, 'italic'], [700, 'normal'], [800, 'normal'], [900, 'normal'],
      ]);
      const cssFiles = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].flatMap(rule => {
        if (!(rule instanceof CSSFontFaceRule) || rule.style.fontFamily.replaceAll('"', '').replaceAll("'", '') !== 'Inter') return [];
        const match = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/);
        return match ? [{ font: new URL(match[1]!, sheet.href!).href, sheet: sheet.href! }] : [];
      })));
      expect(cssFiles).toHaveLength(12);
      // Vite copies the npm WOFF2 bytes; both screen and hidden export import this same shared CSS.
      const exportHtml = fs.readFileSync(path.join(REPO_ROOT, 'apps/desktop/out/renderer/export-page/index.html'), 'utf8');
      for (const sheet of new Set(cssFiles.map(file => file.sheet))) expect(exportHtml).toContain(path.basename(fileURLToPath(sheet)));
      const sourceFiles: string[] = [...new Set(bindings.flatMap((b: any) => b.cssFiles))] as string[];
      for (const source of sourceFiles) {
        const prefix = path.basename(source, '.woff2') + '-';
        const asset = cssFiles.find(file => path.basename(fileURLToPath(file.font)).startsWith(prefix))?.font;
        expect(asset, `CSS includes ${source}`).toBeDefined();
        expect(fs.readFileSync(fileURLToPath(asset!))).toEqual(fs.readFileSync(source));
      }
      // The existing migration spec owns the unchanged pixel baselines. Preserve a view of this file-level proof.
      await waitForStable(page);
      await page.locator('.galley-page').screenshot({ path: path.join(output, `${name}-current.png`), scale: 'css' });
      console.log(JSON.stringify({ name, cssSourceFilesVerified: sourceFiles.length }));
    });
  });
}
