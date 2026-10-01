import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// P1-03 acceptance: "a grep shows both entries import @galley/render". The editor canvas and the export page must draw
// pages with the same component, so exported pages can never drift from what the editor shows.

const src = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const importsRender = (file: string) => /from\s+['"]@galley\/render(\/[\w.-]+)?['"]/.test(fs.readFileSync(file, 'utf8'));

describe('both page entries use the shared renderer', () => {
  it('the editor canvas imports PageView from @galley/render', () => {
    const canvas = fs.readFileSync(path.join(src, 'renderer/canvas/Canvas.tsx'), 'utf8');
    expect(canvas).toMatch(/import\s*\{[^}]*\bPageView\b[^}]*\}\s*from\s*'@galley\/render'/);
    expect(sourceFiles(path.join(src, 'renderer')).filter(importsRender).length).toBeGreaterThan(0);
  });

  it('the export page imports PageView from @galley/render', () => {
    const main = fs.readFileSync(path.join(src, 'export-page/main.tsx'), 'utf8');
    expect(main).toMatch(/import\s*\{[^}]*\bPageView\b[^}]*\}\s*from\s*'@galley\/render'/);
    expect(sourceFiles(path.join(src, 'export-page')).filter(importsRender).length).toBeGreaterThan(0);
  });

  it('the export page pulls in none of the editor (no store, shell or canvas), so no chrome can reach a PDF', () => {
    for (const file of sourceFiles(path.join(src, 'export-page'))) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/from\s+['"]\.\.\/renderer/);
    }
  });

  it('neither entry draws pages itself: no shape or text markup outside @galley/render', () => {
    for (const file of [...sourceFiles(path.join(src, 'renderer')), ...sourceFiles(path.join(src, 'export-page'))]) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/<(rect|ellipse|line|svg)\b/);
    }
  });
});
