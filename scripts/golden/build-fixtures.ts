/**
 * Writes fixtures/golden/swatch-chart.galley/{document.json,links.json} from swatch-chart.ts. Run with
 * `npm run fixtures:golden`. A unit test (packages/prepress/test/golden-fixture.test.ts) fails when the committed files
 * drift from this builder's output.
 */
import { serializeDocument } from '@galley/model';
import fs from 'node:fs';
import path from 'node:path';
import { buildSwatchChart, CHART_ENGINE_VERSION } from './swatch-chart';

export const GOLDEN_FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/golden');

export function swatchChartFiles() {
  return serializeDocument(buildSwatchChart(), { engineVersion: CHART_ENGINE_VERSION });
}

function main(): void {
  const dir = path.join(GOLDEN_FIXTURES_DIR, 'swatch-chart.galley');
  fs.mkdirSync(dir, { recursive: true });
  const files = swatchChartFiles();
  fs.writeFileSync(path.join(dir, 'document.json'), files.document);
  fs.writeFileSync(path.join(dir, 'links.json'), files.links);
  console.log(`wrote ${path.relative(process.cwd(), dir)}/document.json and links.json`);
}

if (require.main === module) main();
