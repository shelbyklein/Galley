import { buildSentinelTable, parseDocument, serializeDocument, validateDocument } from '@galley/model';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSwatchChart, CHART_ENGINE_VERSION } from '../../../scripts/golden/swatch-chart';

const dir = fileURLToPath(new URL('../../../fixtures/golden/swatch-chart.galley/', import.meta.url));
const read = (f: string) => fs.readFileSync(dir + f, 'utf8');

describe('fixtures/golden/swatch-chart.galley', () => {
  it('is what scripts/golden/swatch-chart.ts builds (run `npm run fixtures:golden` after changing the builder)', () => {
    const files = serializeDocument(buildSwatchChart(), { engineVersion: CHART_ENGINE_VERSION });
    expect(read('document.json')).toBe(files.document);
    expect(read('links.json')).toBe(files.links);
  });

  it('parses, validates, and covers every ink behavior the golden checks look for', () => {
    const doc = parseDocument({ document: read('document.json'), links: read('links.json') });
    expect(validateDocument(doc)).toEqual([]);
    const table = buildSentinelTable(doc);
    // process, tinted process, a saved tint, two spots (one full, one tinted, one saved tint), overprint, paper, black
    // (a paint tint and a saved tint of the same percentage are one ink)
    expect(table.filter((e) => e.model === 'spot').map((e) => `${e.name} ${e.tint}%`)).toEqual(['PANTONE 185 C 100%', 'PANTONE 185 C 40%', 'PANTONE 2995 C 100%', 'PANTONE 2995 C 70%']);
    expect(table.some((e) => e.overprint && e.swatchId === 'black')).toBe(true);
    expect(table.some((e) => e.swatchId === 'paper')).toBe(true);
    expect(table.some((e) => e.swatchId === 'teal' && e.tint === 50)).toBe(true);
    const page = doc.pages[doc.pageOrder[0]!]!;
    expect([page.width, page.height]).toEqual([612, 792]);
    expect(page.bleed.left).toBe(9);
    expect(page.slug.left).toBe(36);
  });
});
